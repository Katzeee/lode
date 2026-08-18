import { describe, expect, it } from "vitest";

import { actorIdFromPublicKey, generateSigningKeyPair, signBytes } from "../../crypto/index.js";
import { admitAuthorityRecords } from "../admission/index.js";
import {
  factTransactionId,
  makeFact,
  workspaceGenesisMutations,
  type Fact,
  type FactBody,
  type FactFrontier,
} from "../fact/index.js";
import { projectGovernance, syncAdmittedPeers, type GovernanceState } from "./index.js";

/**
 * Governance acceptance: attribution, membership, and transit admission are
 * deterministic functions of the record set — the same merged journal yields
 * the same governance state on every replica regardless of merge order, and
 * invalid inputs either fault closed (attribution) or have no governance
 * effect (authorization, staleness).
 */

const WORKSPACE = "workspace";
const REPLICA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const REPLICA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
/** Deterministic, shape-valid base64 of 32 bytes. */
const KX_KEY = Buffer.alloc(32, 7).toString("base64");
const EPHEMERAL = Buffer.alloc(32, 11).toString("base64");

type Actor = Readonly<{ actorId: string; seed: Uint8Array }>;

function actor(): Actor {
  const pair = generateSigningKeyPair();
  return { actorId: actorIdFromPublicKey(pair.publicKey), seed: pair.seed };
}

function signedFact(input: {
  replicaId: string;
  sequence: number;
  observed: FactFrontier;
  lamport: number;
  body: FactBody;
  signer: Actor;
}): Fact {
  const base = makeFact({
    workspaceId: WORKSPACE,
    replicaId: input.replicaId,
    sequence: input.sequence,
    observed: input.observed,
    lamport: input.lamport,
    body: input.body,
  });
  return {
    ...base,
    attribution: Buffer.from(signBytes(Buffer.from(base.contentDigest, "utf8"), input.signer.seed)).toString("base64"),
  };
}

function unsignedFact(input: {
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

function contributionBody(actorId: string): FactBody {
  return {
    kind: "contribution",
    actorId,
    intent: "direct",
    mutation: {
      kind: "text-splice",
      nodeId: WORKSPACE,
      deleteAtomIds: [],
      deletedAtoms: [],
      anchor: { after: null, before: null, affinity: "after", fallback: "end" },
      insert: `note-${actorId.slice(6, 12)}`,
    },
  };
}

/** Contiguous signed Facts forming one transaction chain. */
function signedTransaction(input: {
  replicaId: string;
  startSequence: number;
  observed: FactFrontier;
  startLamport: number;
  signer: Actor;
  bodies: readonly FactBody[];
}): Fact[] {
  const transactionId = factTransactionId(WORKSPACE, input.replicaId, input.startSequence);
  let observed = input.observed;
  return input.bodies.map((body, index) => {
    const sequence = input.startSequence + index;
    const fact: Fact = makeFact({
      workspaceId: WORKSPACE,
      replicaId: input.replicaId,
      sequence,
      observed,
      lamport: input.startLamport + index,
      transaction: { transactionId, index, size: input.bodies.length },
      body,
    });
    const signed: Fact = {
      ...fact,
      attribution: Buffer.from(signBytes(Buffer.from(fact.contentDigest, "utf8"), input.signer.seed)).toString(
        "base64",
      ),
    };
    observed = { ...observed, [input.replicaId]: sequence };
    return signed;
  });
}

function genesisBodies(actorId: string): readonly FactBody[] {
  return workspaceGenesisMutations(WORKSPACE).map((mutation) => ({
    kind: "contribution" as const,
    actorId,
    intent: "direct" as const,
    mutation,
  }));
}

function unsignedTransaction(input: {
  replicaId: string;
  startSequence: number;
  observed: FactFrontier;
  startLamport: number;
  bodies: readonly FactBody[];
}): Fact[] {
  const transactionId = factTransactionId(WORKSPACE, input.replicaId, input.startSequence);
  let observed = input.observed;
  return input.bodies.map((body, index) => {
    const sequence = input.startSequence + index;
    const fact = makeFact({
      workspaceId: WORKSPACE,
      replicaId: input.replicaId,
      sequence,
      observed,
      lamport: input.startLamport + index,
      transaction: { transactionId, index, size: input.bodies.length },
      body,
    });
    observed = { ...observed, [input.replicaId]: sequence };
    return fact;
  });
}

/** A governed journal shaped like production establish: governance facts plus
 * a signed genesis transaction and one member contribution. */
function governedJournal(owner: Actor): readonly Fact[] {
  const establish = signedFact({
    replicaId: REPLICA_A,
    sequence: 1,
    observed: {},
    lamport: 1,
    body: establishBody(owner.actorId),
    signer: owner,
  });
  const peerAdmission = signedFact({
    replicaId: REPLICA_A,
    sequence: 2,
    observed: { [REPLICA_A]: 1 },
    lamport: 2,
    body: peerAdmitBody(owner.actorId, "peer_owner", 0),
    signer: owner,
  });
  const genesis = signedTransaction({
    replicaId: REPLICA_A,
    startSequence: 3,
    observed: { [REPLICA_A]: 2 },
    startLamport: 3,
    signer: owner,
    bodies: genesisBodies(owner.actorId),
  });
  const last = genesis.at(-1)!;
  const contribution = signedFact({
    replicaId: REPLICA_A,
    sequence: last.coordinate.dot.sequence + 1,
    observed: { [REPLICA_A]: last.coordinate.dot.sequence },
    lamport: last.coordinate.lamport + 1,
    body: contributionBody(owner.actorId),
    signer: owner,
  });
  return [establish, peerAdmission, ...genesis, contribution];
}

describe("production governance admission", () => {
  it("GOV-1 attribution is a pure Fact property: wrong signer faults, unsigned faults", () => {
    const owner = actor();
    const impostor = actor();
    const journal = governedJournal(owner);
    const forged = signedFact({
      replicaId: REPLICA_A,
      sequence: 3,
      observed: { [REPLICA_A]: 2 },
      lamport: 3,
      body: contributionBody(owner.actorId),
      signer: impostor,
    });
    expect(admitAuthorityRecords(WORKSPACE, [...journal, forged]).kind).toBe("fault");
    const unsigned = unsignedFact({
      replicaId: REPLICA_A,
      sequence: 3,
      observed: { [REPLICA_A]: 2 },
      lamport: 3,
      body: contributionBody(owner.actorId),
    });
    expect(admitAuthorityRecords(WORKSPACE, [...journal, unsigned]).kind).toBe("fault");
  });

  it("non-member contributions fault deterministically regardless of arrival order", () => {
    const owner = actor();
    const outsider = actor();
    const memberFact = governedJournal(owner).at(-1)!;
    const outsiderFact = signedFact({
      replicaId: REPLICA_B,
      sequence: 1,
      observed: { [REPLICA_A]: 1 },
      lamport: 2,
      body: contributionBody(outsider.actorId),
      signer: outsider,
    });
    const records = [
      { recordKind: "fact" as const, fact: governedJournal(owner)[0] },
      { recordKind: "fact" as const, fact: memberFact },
      { recordKind: "fact" as const, fact: outsiderFact },
    ];
    expect(admitAuthorityRecords(WORKSPACE, records).kind).toBe("fault");
    expect(admitAuthorityRecords(WORKSPACE, [records[0], records[2], records[1]]).kind).toBe("fault");
  });

  it("an ungoverned journal rejects attributed Facts as firmly as a governed one rejects bare Facts", () => {
    const owner = actor();
    const attributed = signedFact({
      replicaId: REPLICA_A,
      sequence: 1,
      observed: {},
      lamport: 1,
      body: contributionBody(owner.actorId),
      signer: owner,
    });
    expect(admitAuthorityRecords(WORKSPACE, [{ recordKind: "fact", fact: attributed }]).kind).toBe("fault");
    const bare = unsignedTransaction({
      replicaId: REPLICA_A,
      startSequence: 1,
      observed: {},
      startLamport: 1,
      bodies: genesisBodies(owner.actorId),
    });
    expect(admitAuthorityRecords(WORKSPACE, bare.map(toRecord)).kind).toBe("ready");
  });

  it("a second establish faults the journal no matter which replica authored it", () => {
    const left = actor();
    const right = actor();
    const journal = governedJournal(left);
    const secondGenesis = signedFact({
      replicaId: REPLICA_B,
      sequence: 1,
      observed: { [REPLICA_A]: 2 },
      lamport: 3,
      body: establishBody(right.actorId),
      signer: right,
    });
    const admission = admitAuthorityRecords(WORKSPACE, [...journal, secondGenesis].map(toRecord));
    expect(admission.kind).toBe("fault");
    if (admission.kind === "fault") {
      expect(admission.fault).toContain("establish");
    }
  });

  it("an establishment cannot name an owner different from its attributed Actor", () => {
    const signer = actor();
    const namedOwner = actor();
    const fact = signedFact({
      replicaId: REPLICA_A,
      sequence: 1,
      observed: {},
      lamport: 1,
      body: {
        kind: "governance",
        actorId: signer.actorId,
        action: { kind: "workspace-establish", ownerActorId: namedOwner.actorId },
      },
      signer,
    });
    const admission = admitAuthorityRecords(WORKSPACE, [toRecord(fact)]);
    expect(admission.kind).toBe("fault");
    if (admission.kind === "fault") {
      expect(admission.fault).toContain("owner");
    }
  });

  it("GOV-2 concurrent governance converges under different merge orders", () => {
    const owner = actor();
    const member = actor();
    const journal = governedJournal(owner);
    const next = after(journal);
    const admitMember = signedFact({
      replicaId: REPLICA_A,
      sequence: next.sequence,
      observed: next.observed,
      lamport: next.lamport,
      body: {
        kind: "governance",
        actorId: owner.actorId,
        action: { kind: "actor-admit", actorId: member.actorId },
      },
      signer: owner,
    });
    // Concurrent: the member self-admits a peer on another replica while the
    // owner rotates transit on the first — every merge order must agree.
    const memberPeerAdmit = signedFact({
      replicaId: REPLICA_B,
      sequence: 1,
      observed: { [REPLICA_A]: next.sequence },
      lamport: next.lamport + 1,
      body: peerAdmitBody(member.actorId, "peer_member", 0),
      signer: member,
    });
    const ownerRotate = signedFact({
      replicaId: REPLICA_A,
      sequence: next.sequence + 1,
      observed: { [REPLICA_A]: next.sequence },
      lamport: next.lamport + 1,
      body: rotateBody(owner.actorId, 1, ["peer_owner"]),
      signer: owner,
    });
    const base = [...journal, admitMember];
    const orders = [
      [...base, memberPeerAdmit, ownerRotate],
      [...base, ownerRotate, memberPeerAdmit],
    ];
    const states = orders.map((facts) => {
      const admission = admitAuthorityRecords(WORKSPACE, facts.map(toRecord));
      if (admission.kind === "fault") {
        throw new Error(admission.fault ?? "fault");
      }
      return governanceState(admission.snapshot.facts);
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

  it("stale rotations and unauthorized governance have no effect, forged signatures fault", () => {
    const owner = actor();
    const member = actor();
    const journal = governedJournal(owner);
    const next = after(journal);
    const admitMember = signedFact({
      replicaId: REPLICA_A,
      sequence: next.sequence,
      observed: next.observed,
      lamport: next.lamport,
      body: { kind: "governance", actorId: owner.actorId, action: { kind: "actor-admit", actorId: member.actorId } },
      signer: owner,
    });
    const staleRotate = signedFact({
      replicaId: REPLICA_B,
      sequence: 1,
      observed: { [REPLICA_A]: next.sequence },
      lamport: next.lamport + 1,
      body: rotateBody(member.actorId, 5, ["peer_member"]),
      signer: member,
    });
    const admission = admitAuthorityRecords(WORKSPACE, [...journal, admitMember, staleRotate].map(toRecord));
    if (admission.kind !== "ready") {
      throw new Error(admission.fault ?? "fault");
    }
    const state = governanceState(admission.snapshot.facts);
    // A member-signed rotation at a bogus epoch is skipped, not applied.
    expect(state.epoch).toBe(0);
  });

  it("removing one Actor leaves admitted Peers serving the others (orthogonal axes)", () => {
    const owner = actor();
    const member = actor();
    const journal = governedJournal(owner);
    const built = [
      ...journal,
      ...["actor-admit", "peer-admit", "actor-remove"].map((kind, index) => {
        const prior = builtFactAt(journal, index);
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
        return signedFact({
          replicaId: REPLICA_A,
          sequence: prior.sequence,
          observed: { [REPLICA_A]: prior.sequence - 1 },
          lamport: prior.lamport,
          body,
          signer: kind === "peer-admit" ? member : owner,
        });
      }),
    ];
    const admission = admitAuthorityRecords(WORKSPACE, built.map(toRecord));
    if (admission.kind !== "ready") {
      throw new Error(
        admission.kind === "fault"
          ? (admission.fault ?? "fault without a reason")
          : `pending: ${admission.pendingTransactionIds.join(", ")}`,
      );
    }
    const state = governanceState(admission.snapshot.facts);
    expect(state.members.has(member.actorId)).toBe(false);
    expect(state.members.has(owner.actorId)).toBe(true);
    // The removed Actor's Peer stays admitted for the remaining members.
    expect(syncAdmittedPeers(state).has("peer_member")).toBe(true);
  });
});

function toRecord(fact: Fact) {
  return { recordKind: "fact" as const, fact };
}

/** Position immediately after a journal's last fact on its replica. */
function after(journal: readonly Fact[]): Readonly<{ sequence: number; observed: FactFrontier; lamport: number }> {
  const last = journal.at(-1)!;
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

function builtFactAt(journal: readonly Fact[], index: number): Readonly<{ sequence: number; lamport: number }> {
  const base = after(journal);
  return { sequence: base.sequence + index, lamport: base.lamport + index };
}
