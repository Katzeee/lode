import {
  mutationWriteMembers,
  type EditMutation,
  type MutationWrite,
} from "../../../domain/edit/index.js";
import type { ActorId, EditIntent, FactSnapshot, Mutation } from "../../../domain/fact/index.js";
import type { ScopedProjectionGeneration } from "../../../domain/reconcile/index.js";
import {
  absorbWriteBoundary,
  editWriteAccumulators,
  editWriteAt,
  finishEditWrite,
} from "./edit-write-accumulator.js";
import { assertNoWorkspaceCreation, expandPlanningEdit } from "./edit-expansion.js";
import { followUpMutations } from "./follow-up.js";
import { expandMutation } from "./expansion/index.js";
import { planningReconciler } from "./planning-reconciler.js";
import { prepareMutation } from "./preparation.js";
import { assertNoBatchCreatedAtomReference, rememberCreatedAtomIds } from "./text-batch-policy.js";

export function prepareEdits(
  workspaceId: string,
  actorId: ActorId,
  operations: readonly EditMutation[],
  generation: ScopedProjectionGeneration,
  intent: EditIntent,
  snapshot: FactSnapshot,
): readonly MutationWrite[] {
  let workingGeneration = generation;
  let workingSnapshot = snapshot;
  const prepared = editWriteAccumulators(operations.length);
  const planning = planningReconciler(workspaceId, actorId, snapshot, generation.identity);
  const batchCreatedAtomIds = new Set<string>();
  assertNoWorkspaceCreation(workspaceId, operations);
  const pending = pendingItems(operations);

  for (let index = 0; index < pending.length; index += 1) {
    const item = pending[index];
    if (!item) {
      continue;
    }
    if (item.stage === "edit") {
      const expansion = expandPlanningEdit(item.operation, workingGeneration.review);
      absorbWriteBoundary(editWriteAt(prepared, item.editIndex), expansion);
      replacePending(pending, index, "expand", item.editIndex, expansion);
      index -= 1;
      continue;
    }
    if (item.stage === "expand") {
      const expansion = expandMutation(item.mutation, workingGeneration.review);
      absorbWriteBoundary(editWriteAt(prepared, item.editIndex), expansion);
      replacePending(pending, index, "prepare", item.editIndex, expansion);
      index -= 1;
      continue;
    }

    assertNoBatchCreatedAtomReference(item.mutation, batchCreatedAtomIds);
    const beforeReview = workingGeneration.review;
    const previous = intent === "direct" ? workingGeneration.origin : beforeReview;
    const mutation = prepareMutation(item.mutation, previous, beforeReview, workingSnapshot);
    const accumulator = editWriteAt(prepared, item.editIndex);
    accumulator.mutations.push(mutation);
    const [firstMutation, ...remainingMutations] = accumulator.mutations;
    if (!firstMutation) {
      throw new Error("Prepared Edit lost its planning Mutation");
    }
    const reconciled = planning.reconcileEdit(
      item.editIndex,
      [firstMutation, ...remainingMutations],
      intent,
    );
    workingSnapshot = reconciled.snapshot;
    workingGeneration = reconciled.generation;
    pending.splice(
      index + 1,
      0,
      ...followUpMutations(mutation, beforeReview, workingGeneration.review).map(
        (followUp): PendingItem => ({
          stage: "expand",
          editIndex: item.editIndex,
          mutation: followUp,
        }),
      ),
    );
    rememberCreatedAtomIds(mutation, reconciled.latestFact.id, batchCreatedAtomIds);
  }
  return prepared.map(finishEditWrite);
}

function pendingItems(operations: readonly EditMutation[]): PendingItem[] {
  return operations.map((operation, editIndex) => ({ stage: "edit", editIndex, operation }));
}

function replacePending(
  pending: PendingItem[],
  index: number,
  stage: "expand" | "prepare",
  editIndex: number,
  expansion: MutationWrite,
): void {
  pending.splice(
    index,
    1,
    ...mutationWriteMembers(expansion).map((mutation): PendingItem => ({
      stage,
      editIndex,
      mutation,
    })),
  );
}

type PendingItem =
  | Readonly<{ stage: "edit"; editIndex: number; operation: EditMutation }>
  | Readonly<{
      stage: "expand" | "prepare";
      editIndex: number;
      mutation: Mutation;
    }>;
