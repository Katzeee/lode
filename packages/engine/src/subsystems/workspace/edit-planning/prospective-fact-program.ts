import {
  factActionId,
  factId,
  graphActionBody,
  makeFact,
  normalizeFrontier,
  type ActorId,
  type EditIntent,
  type Fact,
  type FactActionId,
  type FactSnapshot,
  type ReplicaId,
} from "../../../domain/fact/index.js";
import {
  rebuildGeneration,
  type ProjectionGeneration,
  type ProjectionVersions,
} from "../../../domain/reconcile/index.js";
import type { AuthoredActionBatch } from "./action-batch.js";

export type ProspectiveFactProgram = Readonly<{
  nextActionId(actionIndex: number): FactActionId;
  append(actions: AuthoredActionBatch): Readonly<{ snapshot: FactSnapshot; generation: ProjectionGeneration }>;
}>;

export function createProspectiveFactProgram(
  workspaceId: string,
  actorId: ActorId,
  intent: EditIntent,
  base: FactSnapshot,
  versions: ProjectionVersions,
  replicaId: ReplicaId,
): ProspectiveFactProgram {
  const facts: Fact[] = [];
  const firstSequence = (base.frontier[replicaId] ?? 0) + 1;
  const firstLamport = base.facts.reduce((maximum, fact) => Math.max(maximum, fact.coordinate.lamport), 0) + 1;

  return {
    nextActionId: (actionIndex) =>
      factActionId(factId(workspaceId, replicaId, firstSequence + facts.length), actionIndex),
    append(actions) {
      const sequence = firstSequence + facts.length;
      const observed =
        facts.length === 0 ? base.frontier : normalizeFrontier({ ...base.frontier, [replicaId]: sequence - 1 });
      const fact = makeFact({
        workspaceId,
        replicaId,
        sequence,
        observed,
        lamport: firstLamport + facts.length,
        body: graphActionBody(actorId, intent, actions),
      });
      facts.push(fact);
      const snapshot: FactSnapshot = {
        facts: [...base.facts, ...facts],
        frontier: normalizeFrontier({ ...base.frontier, [replicaId]: sequence }),
      };
      return { snapshot, generation: rebuildGeneration(workspaceId, snapshot, versions) };
    },
  };
}
