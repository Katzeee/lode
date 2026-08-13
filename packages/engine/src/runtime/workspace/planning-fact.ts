import {
  makeFact,
  type EditIntent,
  type FactSnapshot,
  type Mutation,
} from "../../domain/fact/index.js";

const PLANNING_REPLICA = "77777777777777777777777777";

export function createPlanningFact(
  workspaceId: string,
  snapshot: FactSnapshot,
  intent: EditIntent,
  mutation: Mutation,
) {
  const sequence = (snapshot.frontier[PLANNING_REPLICA] ?? 0) + 1;
  return makeFact({
    workspaceId,
    replicaId: PLANNING_REPLICA,
    sequence,
    observed: snapshot.frontier,
    lamport: maximumLamport(snapshot) + 1,
    body: { kind: "contribution", actorId: "planner", intent, mutation },
  });
}

function maximumLamport(snapshot: FactSnapshot): number {
  return snapshot.facts.reduce((maximum, fact) => Math.max(maximum, fact.coordinate.lamport), 0);
}
