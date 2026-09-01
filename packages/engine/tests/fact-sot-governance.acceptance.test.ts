import { describe, expect, it } from "vitest";
import type { GovernanceSummary } from "@lode/sdk/host";

import { stableStringCompare } from "../src/domain/fact/index.js";
import { projectGovernance, type GovernanceState } from "../src/domain/governance/index.js";
import { InMemoryDocumentStore } from "./support/document-store.js";
import { ScopedDocumentStore } from "../src/subsystems/persistence/scoped-document-store.js";
import { FactAuthority } from "../src/subsystems/workspace/authority/fact-authority.js";
import { createTestEngine } from "./support/create-test-engine.js";
import { InMemoryPersistenceBackend } from "./support/persistence/in-memory-persistence-backend.js";
import { assertFactOracleEquivalence } from "./support/reconcile/fact-oracle-equivalence.js";

const passphrase = "fact-sot-governance-passphrase";

describe("Fact source-of-truth governance", () => {
  it("rebuilds the public Governance summary on a receipt-free Fact replica", async () => {
    const persistence = new InMemoryPersistenceBackend();
    const engine = createTestEngine({ persistence });
    await engine.start();
    try {
      const owner = await engine.api.identity.createActor({ label: "Owner", passphrase });
      const member = await engine.api.identity.createActor({ label: "Member", passphrase });
      await engine.api.workspaces.createWorkspace({
        workspaceId: "workspace",
        label: "Governed Workspace",
        ownerActorId: owner.actorId,
      });
      await engine.api.governance.admitActor({
        workspaceId: "workspace",
        actingActorId: owner.actorId,
        actorId: member.actorId,
        requestId: "admit-member",
      });
      await engine.api.governance.transferOwner({
        workspaceId: "workspace",
        actingActorId: owner.actorId,
        nextOwnerActorId: member.actorId,
        requestId: "transfer-owner",
      });
      await engine.api.governance.rotateTransit({
        workspaceId: "workspace",
        actingActorId: member.actorId,
        requestId: "rotate-transit",
      });
      await engine.api.governance.removeActor({
        workspaceId: "workspace",
        actingActorId: member.actorId,
        actorId: owner.actorId,
        requestId: "remove-former-owner",
      });
      const expected = await engine.api.governance.summary("workspace");

      const storage = await persistence.openWorkspace("workspace");
      const authority = await FactAuthority.open({
        workspaceId: "workspace",
        loroPeerId: "999",
        documents: new ScopedDocumentStore(storage.documents, "facts"),
      });
      const snapshot = authority.snapshot();
      expect(normalizedGovernance(projectGovernance(snapshot.facts))).toEqual(normalizedPublicSummary(expected));
      assertFactOracleEquivalence(snapshot.facts, 909);

      const replica = await FactAuthority.open({
        workspaceId: "workspace",
        loroPeerId: "808",
        documents: new InMemoryDocumentStore(),
      });
      await replica.replication.importUpdate(await authority.replication.exportUpdate());
      expect(normalizedGovernance(projectGovernance(replica.snapshot().facts))).toEqual(
        normalizedPublicSummary(expected),
      );
      expect(replica.receipts()).toEqual([]);
    } finally {
      await engine.stop();
    }
  });
});

function normalizedGovernance(state: GovernanceState): unknown {
  return {
    established: state.established,
    ownerActorId: state.ownerActorId,
    memberActorIds: [...state.members].sort(stableStringCompare),
    epoch: state.epoch,
    peers: [...state.peers.values()]
      .map((peer) => ({
        peerId: peer.peerId,
        peerKxPublicKey: peer.kxPublicKey,
        admittedAtEpoch: peer.admittedAtEpoch,
        admittedByActorId: peer.admittedByActorId,
        syncAdmitted: peer.admittedAtEpoch === state.epoch,
      }))
      .sort((left, right) => stableStringCompare(left.peerId, right.peerId)),
  };
}

function normalizedPublicSummary(summary: GovernanceSummary): unknown {
  return {
    ...summary,
    memberActorIds: [...summary.memberActorIds].sort(stableStringCompare),
    peers: [...summary.peers].sort((left, right) => stableStringCompare(left.peerId, right.peerId)),
  };
}
