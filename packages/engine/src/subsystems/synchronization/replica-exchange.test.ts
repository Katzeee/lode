import { describe, expect, it } from "vitest";

import { createReplicaId } from "../workspace/authority/fact-authority.js";
import type { GovernanceAuthority } from "../workspace/workspace-governance.js";
import type { ReplicaExchangeProof } from "../connection/index.js";
import { ReplicaExchangeGateway } from "./replica-exchange.js";

describe("ReplicaExchangeGateway", () => {
  it("rejects exchange before reading replica data when Workspace authority is faulted", async () => {
    const snapshot = { facts: [], frontier: {} } as const;
    const facts: GovernanceAuthority = {
      replicaId: createReplicaId(),
      admission: () => ({ kind: "fault", snapshot, pendingTransactionIds: [], fault: "invalid journal" }),
      snapshot: () => snapshot,
      commit: () => Promise.reject(new Error("not used")),
    };
    const gateway = new ReplicaExchangeGateway(
      {
        peerId: unusedIdentity,
        identityPublicKey: unusedIdentity,
        exchangePublicKey: unusedIdentity,
        sign: unusedIdentity,
        openEnvelope: unusedIdentity,
      },
      (workspaceId) => ({
        workspaceId,
        facts,
        peer: () => ({
          profile: () => Promise.reject(new Error("faulted replica must not be read")),
          fetch: () => Promise.reject(new Error("faulted replica must not be read")),
          send: () => Promise.reject(new Error("faulted replica must not be read")),
        }),
      }),
    );

    await expect(gateway.exchangeProfile(proof)).rejects.toThrow("Workspace authority is faulted");
  });
});

const proof: ReplicaExchangeProof = {
  workspaceId: "workspace",
  peerId: "peer",
  nonce: "nonce",
  signature: new Uint8Array(),
};

function unusedIdentity(): never {
  throw new Error("faulted authority must fail before reading Peer identity");
}
