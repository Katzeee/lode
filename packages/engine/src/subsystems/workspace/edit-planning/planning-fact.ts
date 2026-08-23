import {
  makeFact,
  type ActorId,
  type EditIntent,
  type Fact,
  type FactFrontier,
  type AuthoredAction,
} from "../../../domain/fact/index.js";

export function createPlanningFact(
  workspaceId: string,
  replicaId: string,
  sequence: number,
  observed: FactFrontier,
  lamport: number,
  actorId: ActorId,
  intent: EditIntent,
  actions: readonly [AuthoredAction, ...AuthoredAction[]],
): Fact {
  return makeFact({
    workspaceId,
    replicaId,
    sequence,
    observed,
    lamport,
    body: { kind: "edit", actorId, intent, actions: actions },
  });
}
