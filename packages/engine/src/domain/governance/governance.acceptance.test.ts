import { describe, expect, it } from "vitest";
import { uniqueFacts } from "../../../tests/support/facts.js";

import { actorIdFromPublicKey, generateSigningKeyPair } from "../../crypto/index.js";
import {
  buildFactSnapshot,
  makeFact,
  workspaceGenesisActions,
  type Fact,
  type FactBody,
  type FactFrontier,
} from "../fact/index.js";
import { projectGovernance, syncAdmittedPeers, type GovernanceState } from "./index.js";

/**
 * Governance acceptance: membership, ownership, and transit admission are
 * deterministic functions of the record set. The same merged trusted authority
 * yields the same governance state on every replica regardless of merge order.
 */

const WORKSPACE = "workspace";
const REPLICA_A = "101";
const REPLICA_B = "202";
/** Deterministic, shape-valid base64 of 32 bytes. */
const KX_KEY = Buffer.alloc(32, 7).toString("base64");
const EPHEMERAL = Buffer.alloc(32, 11).toString("base64");

type Actor = Readonly<{ actorId: string }>;

function actor(): Actor {
  const pair = generateSigningKeyPair();
  return { actorId: actorIdFromPublicKey(pair.publicKey) };
}

function authoredFact(input: {
  replicaId: string;
  sequence: number;
  observed: FactFrontier;
  lamport: number;
  body: FactBody;
}): Fact {
  return makeFact({
    workspaceId: WORKSPACE,
    replicaId: input.replicaId,
    sequence: input.sequence,
    observed: input.observed,
    lamport: input.lamport,
    body: input.body,
  });
}

function establishBody(ownerActorId: string): FactBody {
  return { kind: "governance", actorId: ownerActorId, action: { kind: "workspace-establish", ownerActorId } };
}

function peerAdmitBody(actorId: string, peerId: string, epoch: number): FactBody {
  return {
    kind: "governance",
    actorId,
    action: {
      kind: "peer-admit",
      peerId,
      peerKxPublicKey: KX_KEY,
      envelope: { ephemeral: EPHEMERAL, seal: "c2VhbGVkLXRyYW5zaXQtbWF0ZXJpYWwtdGVzdA==" },
      epoch,
    },
  };
}

function rotateBody(actorId: string, epoch: number, peers: readonly string[]): FactBody {
  return {
    kind: "governance",
    actorId,
    action: {
      kind: "transit-rotate",
      epoch,
      peers: peers.map((peerId) => ({
        peerId,
        envelope: { ephemeral: EPHEMERAL, seal: Buffer.from(`rotate-${epoch}-${peerId}`).toString("base64") },
      })),
    },
  };
}

function actionBody(actorId: string): FactBody {
  return {
    kind: "action",
    actorId,
    intent: "direct",
    actions: [
      {
        kind: "rich-text-splice",
        nodeId: WORKSPACE,
        deleteAtomIds: [],
        anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        insert: `note-${actorId.slice(6, 12)}`,
      },
    ],
  };
}

function authoredFacts(input: {
  replicaId: string;
  startSequence: number;
  observed: FactFrontier;
  startLamport: number;
  bodies: readonly FactBody[];
}): Fact[] {
  return input.bodies.map((body, index) => {
    const sequence = input.startSequence + index;
    return makeFact({
      workspaceId: WORKSPACE,
      replicaId: input.replicaId,
      sequence,
      observed: index === 0 ? input.observed : { ...input.observed, [input.replicaId]: sequence - 1 },
      lamport: input.startLamport + index,
      body,
    });
  });
}
function genesisBodies(actorId: string): readonly FactBody[] {
  return [
    {
      kind: "action" as const,
      actorId,
      intent: "direct" as const,
      actions: workspaceGenesisActions(WORKSPACE),
    },
  ];
}

/** A governed authority shaped like production establishment and genesis. */
function governedAuthority(owner: Actor): readonly Fact[] {
  const establish = authoredFact({
    replicaId: REPLICA_A,
    sequence: 1,
    observed: {},
    lamport: 1,
    body: establishBody(owner.actorId),
  });
  const peerAdmission = authoredFact({
    replicaId: REPLICA_A,
    sequence: 2,
    observed: { [REPLICA_A]: 1 },
    lamport: 2,
    body: peerAdmitBody(owner.actorId, "peer_owner", 0),
  });
  const genesis = authoredFacts({
    replicaId: REPLICA_A,
    startSequence: 3,
    observed: { [REPLICA_A]: 2 },
    startLamport: 3,
    bodies: genesisBodies(owner.actorId),
  });
  const last = genesis.at(-1)!;
  const action = authoredFact({
    replicaId: REPLICA_A,
    sequence: last.coordinate.dot.sequence + 1,
    observed: { [REPLICA_A]: last.coordinate.dot.sequence },
    lamport: last.coordinate.lamport + 1,
    body: actionBody(owner.actorId),
  });
  return [establish, peerAdmission, ...genesis, action];
}

describe("governance projection", () => {
  it("deterministically ignores a second establishment", () => {
    const left = actor();
    const right = actor();
    const authority = governedAuthority(left);
    const secondGenesis = authoredFact({
      replicaId: REPLICA_B,
      sequence: 1,
      observed: { [REPLICA_A]: 2 },
      lamport: 3,
      body: establishBody(right.actorId),
    });
    const interpretation = interpret([...authority, secondGenesis]);
    expect(projectGovernance(interpretation.facts).ownerActorId).toBe(left.actorId);
  });

  it("GOV-2 concurrent governance converges under different merge orders", () => {
    const owner = actor();
    const member = actor();
    const authority = governedAuthority(owner);
    const next = after(authority);
    const admitMember = authoredFact({
      replicaId: REPLICA_A,
      sequence: next.sequence,
      observed: next.observed,
      lamport: next.lamport,
      body: {
        kind: "governance",
        actorId: owner.actorId,
        action: { kind: "actor-admit", actorId: member.actorId },
      },
    });
    // Concurrent: the member self-admits a peer on another replica while the
    // owner rotates transit on the first — every merge order must agree.
    const memberPeerAdmit = authoredFact({
      replicaId: REPLICA_B,
      sequence: 1,
      observed: { [REPLICA_A]: next.sequence },
      lamport: next.lamport + 1,
      body: peerAdmitBody(member.actorId, "peer_member", 0),
    });
    const ownerRotate = authoredFact({
      replicaId: REPLICA_A,
      sequence: next.sequence + 1,
      observed: { [REPLICA_A]: next.sequence },
      lamport: next.lamport + 1,
      body: rotateBody(owner.actorId, 1, ["peer_owner"]),
    });
    const base = [...authority, admitMember];
    const orders = [
      [...base, memberPeerAdmit, ownerRotate],
      [...base, ownerRotate, memberPeerAdmit],
    ];
    const states = orders.map((facts) => {
      const interpretation = interpret(facts);
      return governanceState(interpretation.facts);
    });
    const [first, second] = states;
    if (!first || !second) {
      throw new Error("Expected both merge orders to admit");
    }
    expect(second).toEqual(first);
    // The rotation won the epoch: the concurrent peer-admit at epoch 0 is stale
    // (staleAdd) and the member's peer lost sync admission.
    expect(first).toMatchObject({ established: true, ownerActorId: owner.actorId, epoch: 1 });
    expect(syncAdmittedPeers(first).has("peer_member")).toBe(false);
    expect(syncAdmittedPeers(first).has("peer_owner")).toBe(true);
  });

  it("stale rotations and unauthorized governance have no effect", () => {
    const owner = actor();
    const member = actor();
    const authority = governedAuthority(owner);
    const next = after(authority);
    const admitMember = authoredFact({
      replicaId: REPLICA_A,
      sequence: next.sequence,
      observed: next.observed,
      lamport: next.lamport,
      body: { kind: "governance", actorId: owner.actorId, action: { kind: "actor-admit", actorId: member.actorId } },
    });
    const staleRotate = authoredFact({
      replicaId: REPLICA_B,
      sequence: 1,
      observed: { [REPLICA_A]: next.sequence },
      lamport: next.lamport + 1,
      body: rotateBody(member.actorId, 5, ["peer_member"]),
    });
    const interpretation = interpret([...authority, admitMember, staleRotate]);
    const state = governanceState(interpretation.facts);
    // A member-signed rotation at a bogus epoch is skipped, not applied.
    expect(state.epoch).toBe(0);
  });

  it("removing one Actor leaves admitted Peers serving the others (orthogonal axes)", () => {
    const owner = actor();
    const member = actor();
    const authority = governedAuthority(owner);
    const built = [
      ...authority,
      ...["actor-admit", "peer-admit", "actor-remove"].map((kind, index) => {
        const prior = builtFactAt(authority, index);
        const body: FactBody =
          kind === "actor-admit"
            ? { kind: "governance", actorId: owner.actorId, action: { kind: "actor-admit", actorId: member.actorId } }
            : kind === "peer-admit"
              ? peerAdmitBody(member.actorId, "peer_member", 0)
              : {
                  kind: "governance",
                  actorId: owner.actorId,
                  action: { kind: "actor-remove", actorId: member.actorId },
                };
        return authoredFact({
          replicaId: REPLICA_A,
          sequence: prior.sequence,
          observed: { [REPLICA_A]: prior.sequence - 1 },
          lamport: prior.lamport,
          body,
        });
      }),
    ];
    const interpretation = interpret(built);
    const state = governanceState(interpretation.facts);
    expect(state.members.has(member.actorId)).toBe(false);
    expect(state.members.has(owner.actorId)).toBe(true);
    // The removed Actor's Peer stays admitted for the remaining members.
    expect(syncAdmittedPeers(state).has("peer_member")).toBe(true);
  });
});

/** Position immediately after a authority's last fact on its replica. */
function after(authority: readonly Fact[]): Readonly<{ sequence: number; observed: FactFrontier; lamport: number }> {
  const last = authority.at(-1)!;
  const { replicaId, sequence } = last.coordinate.dot;
  return {
    sequence: sequence + 1,
    observed: { ...last.coordinate.observed, [replicaId]: sequence },
    lamport: last.coordinate.lamport + 1,
  };
}

function governanceState(facts: readonly Fact[]): GovernanceState {
  return projectGovernance(facts);
}

function interpret(facts: readonly (Fact | undefined)[]) {
  return buildFactSnapshot(WORKSPACE, uniqueFacts(facts));
}

function builtFactAt(authority: readonly Fact[], index: number): Readonly<{ sequence: number; lamport: number }> {
  const base = after(authority);
  return { sequence: base.sequence + index, lamport: base.lamport + index };
}
