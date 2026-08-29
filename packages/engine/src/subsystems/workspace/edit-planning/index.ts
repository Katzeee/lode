import type { EditAction } from "../../../domain/edit/index.js";
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
  type GraphAction,
  type ReplicaId,
} from "../../../domain/fact/index.js";
import {
  rebuildGeneration,
  type ProjectionGeneration,
  type ProjectionVersions,
  type ScopedProjectionGeneration,
} from "../../../domain/reconcile/index.js";
import { assertNoWorkspaceCreation, expandPlanningEdit } from "./edit-expansion.js";
import { expandAction } from "./expansion/index.js";
import { validatePlannedAction } from "./action-validation.js";
import type { AuthoredActionBatch } from "./action-batch.js";

export type { AuthoredActionBatch } from "./action-batch.js";

export function prepareEdits(
  workspaceId: string,
  actorId: ActorId,
  operations: readonly EditAction[],
  generation: ScopedProjectionGeneration,
  intent: EditIntent,
  snapshot: FactSnapshot,
  replicaId: ReplicaId,
): readonly AuthoredActionBatch[] {
  let workingGeneration = generation;
  const prepared: AuthoredActionBatch[] = [];
  const planning = createPlanningProjection(workspaceId, actorId, intent, snapshot, generation.identity, replicaId);
  assertNoWorkspaceCreation(workspaceId, operations);
  for (const operation of operations) {
    const previous = intent === "direct" ? workingGeneration.origin : workingGeneration.review;
    const actions = expandPlanningEdit(operation, workingGeneration.review, (actionIndex) =>
      planning.actionId(actionIndex),
    ).flatMap((action) => expandAction(action, workingGeneration.review));
    const reconciled = planning.append(nonemptyBatch(actions));
    const validated = actions.map((action) =>
      validatePlannedAction(action, previous, workingGeneration.review, reconciled.generation.review),
    );
    if (validated.some((action, index) => action !== actions[index])) {
      throw new Error("Authored Intent validation must not rewrite a planned Fact");
    }
    prepared.push(nonemptyBatch(validated));
    workingGeneration = reconciled.generation;
  }
  return prepared.map(nonemptyBatch);
}

function createPlanningProjection(
  workspaceId: string,
  actorId: ActorId,
  intent: EditIntent,
  base: FactSnapshot,
  versions: ProjectionVersions,
  replicaId: ReplicaId,
): Readonly<{
  actionId(actionIndex: number): FactActionId;
  append(actions: AuthoredActionBatch): Readonly<{ snapshot: FactSnapshot; generation: ProjectionGeneration }>;
}> {
  const facts: Fact[] = [];
  const firstSequence = (base.frontier[replicaId] ?? 0) + 1;
  const firstLamport = base.facts.reduce((maximum, fact) => Math.max(maximum, fact.coordinate.lamport), 0) + 1;

  return {
    actionId: (actionIndex) => factActionId(factId(workspaceId, replicaId, firstSequence + facts.length), actionIndex),
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

function nonemptyBatch(actions: readonly GraphAction[]): AuthoredActionBatch {
  const [first, ...rest] = actions;
  if (!first) {
    throw new Error("Prepared Edit contains no actions");
  }
  return [first, ...rest];
}
