import type { EditAction } from "../../../domain/edit/index.js";
import {
  factActionsFromFacts,
  frontierOf,
  type ActorId,
  type EditIntent,
  type Fact,
  type FactSnapshot,
  type AuthoredAction,
  type ReceiptInverseBatch,
  type ReplicaId,
} from "../../../domain/fact/index.js";
import { planCompensation } from "../../../domain/history/index.js";
import { rebuildGeneration, type ScopedProjectionGeneration } from "../../../domain/reconcile/index.js";
import { assertNoWorkspaceCreation, expandPlanningEdit } from "./edit-expansion.js";
import { expandAction } from "./expansion/index.js";
import { planningReconciler } from "./planning-reconciler.js";
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
): Readonly<{ writes: readonly AuthoredActionBatch[]; inverse: readonly ReceiptInverseBatch[] }> {
  let workingGeneration = generation;
  let workingSnapshot = snapshot;
  const prepared: AuthoredActionBatch[] = [];
  const planning = planningReconciler(workspaceId, actorId, snapshot, generation.identity, replicaId);
  assertNoWorkspaceCreation(workspaceId, operations);
  for (const [editIndex, operation] of operations.entries()) {
    const previous = intent === "direct" ? workingGeneration.origin : workingGeneration.review;
    const actions = expandPlanningEdit(operation, workingGeneration.review, (actionIndex) =>
      planning.actionId(editIndex, actionIndex),
    ).flatMap((action) => expandAction(action, workingGeneration.review));
    const reconciled = planning.reconcileEdit(editIndex, nonemptyBatch(actions), intent);
    const validated = actions.map((action) =>
      validatePlannedAction(action, previous, workingGeneration.review, reconciled.generation.review),
    );
    if (validated.some((action, index) => action !== actions[index])) {
      throw new Error("Authored Intent validation must not rewrite a planned Fact");
    }
    prepared.push(nonemptyBatch(validated));
    workingSnapshot = reconciled.snapshot;
    workingGeneration = reconciled.generation;
  }
  const writes = prepared.map(nonemptyBatch);
  const planned = { facts: planning.facts(), snapshot: workingSnapshot, generation: workingGeneration };
  return { writes, inverse: inverseFromPlanning(planned, intent) };
}

function nonemptyBatch(actions: readonly AuthoredAction[]): AuthoredActionBatch {
  const [first, ...rest] = actions;
  if (!first) {
    throw new Error("Prepared Edit contains no actions");
  }
  return [first, ...rest];
}

export function prepareReceiptInverse(
  workspaceId: string,
  actorId: ActorId,
  batches: readonly ReceiptInverseBatch[],
  generation: ScopedProjectionGeneration,
  snapshot: FactSnapshot,
  replicaId: ReplicaId,
): readonly ReceiptInverseBatch[] {
  const planning = planningReconciler(workspaceId, actorId, snapshot, generation.identity, replicaId);
  let workingSnapshot = snapshot;
  let workingGeneration = generation;
  batches.forEach((batch, index) => {
    const reconciled = planning.reconcileEdit(index, batch.actions, batch.intent);
    workingSnapshot = reconciled.snapshot;
    workingGeneration = reconciled.generation;
  });
  const planned = { facts: planning.facts(), snapshot: workingSnapshot, generation: workingGeneration };
  return inverseFromPlanning(planned, batches[0]?.intent ?? "direct");
}

function inverseFromPlanning(
  planned: Readonly<{
    facts: readonly Fact[];
    snapshot: FactSnapshot;
    generation: ScopedProjectionGeneration;
  }>,
  intent: EditIntent,
): readonly ReceiptInverseBatch[] {
  const plannedIds = new Set(planned.facts.map((fact) => fact.id));
  const baseFacts = planned.snapshot.facts.filter((fact) => !plannedIds.has(fact.id));
  const versions = {
    rulesVersion: planned.generation.identity.rulesVersion,
    schemaVersion: planned.generation.identity.schemaVersion,
  };
  const result: ReceiptInverseBatch[] = [];
  for (let index = planned.facts.length - 1; index >= 0; index -= 1) {
    const target = planned.facts[index];
    if (!target) {
      continue;
    }
    const facts = [...baseFacts, ...planned.facts.slice(0, index + 1)];
    const snapshot = { facts, frontier: frontierOf(facts) };
    const generation = rebuildGeneration(planned.generation.identity.workspaceNodeId, snapshot, versions);
    const compensation = planCompensation(factActionsFromFacts([target]), snapshot, generation);
    if (compensation.kind !== "ready") {
      continue;
    }
    const [first, ...rest] = compensation.actions;
    if (first) {
      result.push({ intent, actions: [first, ...rest] });
    }
  }
  return result;
}
