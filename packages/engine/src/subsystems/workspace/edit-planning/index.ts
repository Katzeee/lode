import type { EditAction } from "../../../domain/edit/index.js";
import {
  type ActorId,
  type EditIntent,
  type FactSnapshot,
  type GraphAction,
  type ReplicaId,
} from "../../../domain/fact/index.js";
import type { InterpretedProjectionGeneration } from "../../../domain/reconcile/index.js";
import { assertNoWorkspaceCreation, expandPlanningEdit } from "./edit-expansion.js";
import { expandAction } from "./expansion/index.js";
import { validatePlannedAction } from "./action-validation.js";
import type { AuthoredActionBatch } from "./action-batch.js";
import { createProspectiveFactProgram } from "./prospective-fact-program.js";

export type { AuthoredActionBatch } from "./action-batch.js";

export function prepareEdits(
  workspaceId: string,
  actorId: ActorId,
  operations: readonly EditAction[],
  generation: InterpretedProjectionGeneration,
  intent: EditIntent,
  snapshot: FactSnapshot,
  replicaId: ReplicaId,
): readonly AuthoredActionBatch[] {
  let workingGeneration = generation;
  const prepared: AuthoredActionBatch[] = [];
  const program = createProspectiveFactProgram(workspaceId, actorId, intent, snapshot, generation.identity, replicaId);
  assertNoWorkspaceCreation(workspaceId, operations);
  for (const operation of operations) {
    const previous = intent === "direct" ? workingGeneration.origin : workingGeneration.review;
    const actions = expandPlanningEdit(operation, workingGeneration.review, (actionIndex) =>
      program.nextActionId(actionIndex),
    ).flatMap((action) => expandAction(action, workingGeneration.review));
    const reconciled = program.append(nonemptyBatch(actions));
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

function nonemptyBatch(actions: readonly GraphAction[]): AuthoredActionBatch {
  const [first, ...rest] = actions;
  if (!first) {
    throw new Error("Prepared Edit contains no actions");
  }
  return [first, ...rest];
}
