import {
  factTransactionId,
  makeFact,
  normalizeFrontier,
  type ActorId,
  type EditIntent,
  type Fact,
  type FactSnapshot,
  type Mutation,
} from "../../../domain/fact/index.js";

const PLANNING_REPLICA = "77777777777777777777777777";

export function createPlanningTransaction(
  workspaceId: string,
  before: FactSnapshot,
  actorId: ActorId,
  intent: EditIntent,
  mutations: readonly [Mutation, ...Mutation[]],
): readonly [Fact, ...Fact[]] {
  const firstSequence = (before.frontier[PLANNING_REPLICA] ?? 0) + 1;
  const transactionId = factTransactionId(workspaceId, PLANNING_REPLICA, firstSequence);
  let observed = before.frontier;
  const facts = mutations.map((mutation, index) => {
    const sequence = firstSequence + index;
    const fact = makeFact({
      workspaceId,
      replicaId: PLANNING_REPLICA,
      sequence,
      observed,
      lamport: maximumLamport(before) + index + 1,
      transaction: { transactionId, index, size: mutations.length },
      body: { kind: "contribution", actorId, intent, mutation },
    });
    observed = normalizeFrontier({ ...observed, [PLANNING_REPLICA]: sequence });
    return fact;
  });
  const [first, ...rest] = facts;
  if (!first) {
    throw new Error("Planning transaction requires at least one Mutation");
  }
  return [first, ...rest];
}

function maximumLamport(snapshot: FactSnapshot): number {
  return snapshot.facts.reduce((maximum, fact) => Math.max(maximum, fact.coordinate.lamport), 0);
}
