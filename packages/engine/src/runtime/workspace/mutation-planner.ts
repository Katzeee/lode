import {
  frontierOf,
  type EditIntent,
  type FactSnapshot,
  type Mutation,
} from "../../domain/fact/index.js";
import {
  expandEditMutation,
  mutationWriteMembers,
  singleMutationWrite,
  type EditMutation,
  type MutationWrite,
} from "../../domain/edit/index.js";
import {
  assertMaterializedField,
  type ProjectionGeneration,
} from "../../domain/reconcile/index.js";
import { applyPlanningMutation } from "./planning-projection.js";
import { prepareSchemaMutation } from "./planning-schema-relations.js";
import {
  prepareFieldInitialization,
  schemaApplicationInitializations,
} from "./field-initialization-planner.js";
import {
  assertNoBatchCreatedAtomReference,
  prepareTextMark,
  prepareTextSplice,
} from "./text-mutation-planner.js";
import { prepareTemplateDetachment } from "./template-node-mutation-planner.js";
import { prepareFieldContentDeletion } from "./field-content-deletion-planner.js";
import {
  assertParent,
  prepareMutableOccurrence,
  prepareOccurrenceCreate,
} from "./occurrence-mutation-planner.js";
import { prepareValueMutation } from "./value-mutation-planner.js";
import { expandMutation } from "./mutation-expansion.js";
import { createPlanningFact } from "./planning-fact.js";
import {
  absorbWriteBoundary,
  editWriteAccumulators,
  editWriteAt,
  finishEditWrite,
} from "./edit-write-accumulator.js";

export function prepareEdits(
  workspaceId: string,
  operations: readonly EditMutation[],
  generation: ProjectionGeneration,
  intent: EditIntent,
  snapshot: FactSnapshot,
): readonly MutationWrite[] {
  let workingGeneration = generation;
  let workingSnapshot = snapshot;
  const prepared = editWriteAccumulators(operations.length);
  const batchCreatedAtomIds = new Set<string>();
  assertNoWorkspaceCreation(workspaceId, operations);
  const pending = pendingItems(operations);
  for (let index = 0; index < pending.length; index += 1) {
    const item = pending[index];
    if (!item) {
      continue;
    }
    const previous = intent === "direct" ? workingGeneration.origin : workingGeneration.review;
    if (item.stage === "edit") {
      const expansion =
        item.operation.kind === "reference-promote"
          ? singleMutationWrite(
              prepareReferencePromotion(item.operation.occurrenceId, workingGeneration.review),
            )
          : expandEditMutation(item.operation);
      absorbWriteBoundary(editWriteAt(prepared, item.editIndex), expansion);
      pending.splice(
        index,
        1,
        ...mutationWriteMembers(expansion).map((mutation): PendingItem => ({
          stage: "expand",
          editIndex: item.editIndex,
          mutation,
        })),
      );
      index -= 1;
      continue;
    }
    if (item.stage === "expand") {
      const expansion = expandMutation(item.mutation, workingGeneration.review);
      absorbWriteBoundary(editWriteAt(prepared, item.editIndex), expansion);
      pending.splice(
        index,
        1,
        ...mutationWriteMembers(expansion).map((mutation): PendingItem => ({
          stage: "prepare",
          editIndex: item.editIndex,
          mutation,
        })),
      );
      index -= 1;
      continue;
    }
    const mutation = item.mutation;
    assertNoBatchCreatedAtomReference(mutation, batchCreatedAtomIds);
    const next = prepareMutation(mutation, previous, workingGeneration.review, workingSnapshot);
    if (next.kind === "schema-apply") {
      pending.splice(
        index + 1,
        0,
        ...schemaApplicationInitializations(next, workingGeneration.review).map(
          (mutation): PendingItem => ({
            stage: "expand",
            editIndex: item.editIndex,
            mutation,
          }),
        ),
      );
    }
    editWriteAt(prepared, item.editIndex).mutations.push(next);
    const fact = createPlanningFact(workspaceId, workingSnapshot, intent, next);
    if (next.kind === "text-splice") {
      [...next.insert].forEach((_, atomIndex) => {
        batchCreatedAtomIds.add(`${fact.id}#${atomIndex}`);
      });
    }
    const facts = [...workingSnapshot.facts, fact];
    workingSnapshot = { facts, frontier: frontierOf(facts) };
    workingGeneration = applyPlanningMutation(
      workingGeneration,
      next,
      fact.id,
      intent,
      workingSnapshot,
    );
  }
  return prepared.map(finishEditWrite);
}

function pendingItems(operations: readonly EditMutation[]): PendingItem[] {
  return operations.map((operation, editIndex) => ({
    stage: "edit",
    editIndex,
    operation,
  }));
}

function assertNoWorkspaceCreation(workspaceId: string, operations: readonly EditMutation[]): void {
  if (
    operations.some(
      (operation) => operation.kind === "node-create" && operation.nodeId === workspaceId,
    )
  ) {
    throw new Error("Workspace identity is created only by Workspace genesis");
  }
}

type PendingItem =
  | Readonly<{ stage: "edit"; editIndex: number; operation: EditMutation }>
  | Readonly<{
      stage: "expand" | "prepare";
      editIndex: number;
      mutation: Mutation;
    }>;

function prepareReferencePromotion(
  occurrenceId: string,
  available: ProjectionGeneration["review"],
): Mutation {
  const occurrence = available.occurrences[occurrenceId];
  if (!occurrence) {
    throw new Error("Reference promotion target is absent from the current Projection");
  }
  if (available.nodeOwners[occurrence.nodeId] === occurrence.parentNodeId) {
    throw new Error("Reference promotion target is already the Original Occurrence");
  }
  return {
    kind: "node-owner-set",
    nodeId: occurrence.nodeId,
    ownerNodeId: occurrence.parentNodeId,
  };
}

function prepareMutation(
  mutation: Mutation,
  previous: ProjectionGeneration["review"],
  available: ProjectionGeneration["review"],
  snapshot: FactSnapshot,
): Mutation {
  if (isSchemaMutation(mutation)) {
    return prepareSchemaMutation(mutation, available);
  }
  if (isFieldContentDeletion(mutation)) {
    return prepareFieldContentDeletion(mutation, previous, available);
  }
  const preparedOccurrence = prepareMutableOccurrence(mutation, previous, available);
  if (preparedOccurrence) {
    return preparedOccurrence;
  }
  switch (mutation.kind) {
    case "text-splice":
      return prepareTextSplice(mutation, available);
    case "text-mark":
      return prepareTextMark(mutation, previous, available);
    case "value-set":
    case "value-unset":
      return prepareValueMutation(mutation, previous, available);
    case "node-owner-set": {
      if (
        !available.nodes[mutation.ownerNodeId] ||
        !Object.values(available.occurrences).some(
          (occurrence) =>
            occurrence.nodeId === mutation.nodeId &&
            occurrence.parentNodeId === mutation.ownerNodeId,
        )
      ) {
        throw new Error("Owner target is not an observed parent Node placement");
      }
      const previousOwnerNodeId = previous.nodeOwners[mutation.nodeId];
      if (!previousOwnerNodeId) {
        throw new Error("Workspace Node ownership cannot change");
      }
      let ancestor: string | null | undefined = mutation.ownerNodeId;
      const visited = new Set<string>();
      while (ancestor !== null && ancestor !== undefined) {
        if (ancestor === mutation.nodeId || visited.has(ancestor)) {
          throw new Error("Node ownership would form a cycle");
        }
        visited.add(ancestor);
        ancestor = previous.nodeOwners[ancestor];
      }
      return {
        ...mutation,
        previousOwnerNodeId,
      };
    }
    case "node-delete":
      if (!available.nodes[mutation.nodeId]) {
        throw new Error(`Delete target Node does not exist: ${mutation.nodeId}`);
      }
      return mutation;
    case "node-restore":
      assertDeletion(snapshot, mutation.deletionFactId, "node-delete", mutation.nodeId);
      return mutation;
    case "occurrence-create":
      return prepareOccurrenceCreate(mutation, available);
    case "occurrence-restore":
      assertDeletion(snapshot, mutation.deletionFactId, "occurrence-delete", mutation.occurrenceId);
      assertParent(available, mutation.parentNodeId);
      return mutation;
    case "field-materialize":
      assertMaterializedField(mutation, available);
      return mutation;
    case "field-initialize":
      return prepareFieldInitialization(mutation, available);
    case "template-node-detach":
      return prepareTemplateDetachment(mutation, available);
    case "occurrence-move":
    case "occurrence-delete":
      return prepareMutableOccurrence(mutation, previous, available) ?? mutation;
    case "node-create":
      return prepareNodeCreate(mutation);
  }
}

function prepareNodeCreate(mutation: Extract<Mutation, { kind: "node-create" }>): Mutation {
  return mutation;
}

function isSchemaMutation(
  mutation: Mutation,
): mutation is Extract<Mutation, { kind: `schema-${string}` }> {
  return mutation.kind.startsWith("schema-");
}

function isFieldContentDeletion(
  mutation: Mutation,
): mutation is Extract<Mutation, { kind: "field-value-delete" | "materialized-field-delete" }> {
  return mutation.kind === "field-value-delete" || mutation.kind === "materialized-field-delete";
}

function assertDeletion(
  snapshot: FactSnapshot,
  deletionFactId: string,
  kind: "node-delete" | "occurrence-delete",
  identity: string,
): void {
  const deletion = snapshot.facts.find((fact) => fact.id === deletionFactId);
  const mutation = deletion?.body.kind === "contribution" ? deletion.body.mutation : null;
  const matches =
    kind === "node-delete"
      ? mutation?.kind === "node-delete" && mutation.nodeId === identity
      : occurrenceDeletionIdentity(mutation) === identity;
  if (!matches) {
    throw new Error(`Restore does not reference an observed ${kind} Fact`);
  }
}

function occurrenceDeletionIdentity(mutation: Mutation | null): string | null {
  if (mutation?.kind === "occurrence-delete") {
    return mutation.occurrenceId;
  }
  if (mutation?.kind === "field-value-delete") {
    return mutation.valueOccurrenceId;
  }
  return mutation?.kind === "materialized-field-delete" ? mutation.fieldOccurrenceId : null;
}
