import { describe, expect, it } from "vitest";

import { admitAuthorityRecordShapes } from "./admission.js";
import { factTransactionId, makeFact } from "./fact.js";
import type { ContributionBody, Fact, Mutation } from "./types.js";

const WORKSPACE = "workspace";
const REPLICA = "aaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("Fact transactions", () => {
  it("keeps an incomplete transaction outside the admitted snapshot", () => {
    const transactionId = factTransactionId(WORKSPACE, REPLICA, 1);
    const first = makeFact({
      workspaceId: WORKSPACE,
      replicaId: REPLICA,
      sequence: 1,
      observed: {},
      lamport: 1,
      transaction: { transactionId, index: 0, size: 2 },
      body: contribution({ kind: "node-create", nodeId: "node" }),
    });

    expect(admitAuthorityRecordShapes(WORKSPACE, [record(first)])).toEqual({
      kind: "pending",
      snapshot: { facts: [], frontier: {} },
      pendingTransactionIds: [transactionId],
      fault: null,
    });
  });

  it("admits every member at once when the transaction is complete", () => {
    const transactionId = factTransactionId(WORKSPACE, REPLICA, 1);
    const first = makeFact({
      workspaceId: WORKSPACE,
      replicaId: REPLICA,
      sequence: 1,
      observed: {},
      lamport: 1,
      transaction: { transactionId, index: 0, size: 2 },
      body: contribution({ kind: "node-create", nodeId: "node" }),
    });
    const second = makeFact({
      workspaceId: WORKSPACE,
      replicaId: REPLICA,
      sequence: 2,
      observed: { [REPLICA]: 1 },
      lamport: 2,
      transaction: { transactionId, index: 1, size: 2 },
      body: contribution({
        kind: "occurrence-create",
        occurrenceId: "node-original",
        nodeId: "node",
        parentNodeId: WORKSPACE,
        anchor: { after: null, before: null, affinity: "after", fallback: "end" },
      }),
    });

    const admission = admitAuthorityRecordShapes(WORKSPACE, [record(first), record(second)]);
    expect(admission.kind).toBe("ready");
    expect(admission.snapshot.facts.map((fact) => fact.id)).toEqual([first.id, second.id]);
    expect(admission.snapshot.frontier).toEqual({ [REPLICA]: 2 });
  });

  it("treats an ordinary Fact as an implicit singleton transaction", () => {
    const fact = makeFact({
      workspaceId: WORKSPACE,
      replicaId: REPLICA,
      sequence: 1,
      observed: {},
      lamport: 1,
      body: contribution({ kind: "node-create", nodeId: WORKSPACE }),
    });

    expect(fact.transaction).toEqual({
      transactionId: factTransactionId(WORKSPACE, REPLICA, 1),
      index: 0,
      size: 1,
    });
    expect(admitAuthorityRecordShapes(WORKSPACE, [record(fact)]).kind).toBe("ready");
  });
});

function contribution(mutation: Mutation) {
  return contributionBody(mutation);
}

function contributionBody(mutation: Mutation): ContributionBody {
  return { kind: "contribution", actorId: "actor", intent: "direct", mutation };
}

function record(fact: Fact) {
  return { recordKind: "fact" as const, fact };
}
