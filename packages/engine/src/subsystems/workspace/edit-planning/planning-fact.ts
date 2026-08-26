import {
  makeFact,
  graphActionBody,
  type ActorId,
  type EditIntent,
  type Fact,
  type FactFrontier,
  type GraphAction,
} from "../../../domain/fact/index.js";

export function createPlanningFact(
  workspaceId: string,
  replicaId: string,
  sequence: number,
  observed: FactFrontier,
  lamport: number,
  actorId: ActorId,
  intent: EditIntent,
  actions: readonly [GraphAction, ...GraphAction[]],
): Fact {
  return makeFact({
    workspaceId,
    replicaId,
    sequence,
    observed,
    lamport,
    body: graphActionBody(actorId, intent, actions),
  });
}
