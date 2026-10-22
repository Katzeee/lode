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

type ProspectiveFactProgram = Readonly<{
  finalActionId(actionIndex: number): FactActionId;
  previewBatch(actions: AuthoredActionBatch): Readonly<{ snapshot: FactSnapshot; generation: ProjectionGeneration }>;
  appendBatch(actions: AuthoredActionBatch): Readonly<{ snapshot: FactSnapshot; generation: ProjectionGeneration }>;
}>;

type ProspectiveFactProgramInput = Readonly<{
  workspaceId: string;
  actorId: ActorId;
  intent: EditIntent;
  snapshot: FactSnapshot;
  versions: ProjectionVersions;
  replicaId: ReplicaId;
}>;

export function createProspectiveFactProgram(input: ProspectiveFactProgramInput): ProspectiveFactProgram {
  const { workspaceId, actorId, intent, snapshot: base, versions, replicaId } = input;
  const facts: Fact[] = [];
  const firstSequence = (base.frontier[replicaId] ?? 0) + 1;
  const firstLamport = base.facts.reduce((maximum, fact) => Math.max(maximum, fact.coordinate.lamport), 0) + 1;

  const build = (actions: AuthoredActionBatch) => {
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
    const snapshot: FactSnapshot = {
      facts: [...base.facts, ...facts, fact],
      frontier: normalizeFrontier({ ...base.frontier, [replicaId]: sequence }),
    };
    return { fact, snapshot, generation: rebuildGeneration(workspaceId, snapshot, versions) };
  };
  return {
    previewBatch: (actions) => build(actions),
    finalActionId: (actionIndex) =>
      factActionId(factId(workspaceId, replicaId, firstSequence + facts.length), actionIndex),
    appendBatch(actions) {
      const result = build(actions);
      facts.push(result.fact);
      return result;
    },
  };
}
