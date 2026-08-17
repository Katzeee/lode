import {
  compareFacts,
  isFieldContentDeletionMutation,
  isNodeMutation,
  isOccurrenceMutation,
  type ContributionFact,
  type SequenceAnchor,
} from "../fact/index.js";
import { occurrenceAnchor, type ScopedProjection } from "../reconcile/index.js";
import { nodeLocation } from "../reconcile/node-graph.js";
import { deriveSupport } from "../activation/index.js";
import { hasAlternateNodeCreator, hasIndependentOccurrenceWork } from "./compensation-lifecycle.js";
import { compensateNodeOwner } from "./compensation-owner.js";
import { noCompensation, type CompensationStep } from "./compensation-types.js";

export function compensateStructureMutation(
  target: ContributionFact,
  targetIds: ReadonlySet<string>,
  activeFacts: readonly ContributionFact[],
  projection: ScopedProjection,
): CompensationStep | null {
  const mutation = target.body.mutation;
  if (isFieldContentDeletionMutation(mutation)) {
    return compensateOccurrenceDelete(target, targetIds, activeFacts, projection);
  }
  if (isNodeMutation(mutation)) {
    switch (mutation.kind) {
      case "node-create":
      case "node-restore":
        return compensateNodeCreate(target, targetIds, activeFacts, projection);
      case "node-delete":
        return compensateNodeDelete(target, targetIds, activeFacts, projection);
      case "node-owner-set":
        return compensateNodeOwner(target, activeFacts, projection);
      case "intrinsic-node-type-declare":
        return noCompensation();
    }
  }
  if (isOccurrenceMutation(mutation)) {
    switch (mutation.kind) {
      case "occurrence-create":
      case "occurrence-restore":
        return compensateOccurrenceCreate(target, targetIds, activeFacts, projection);
      case "occurrence-delete":
        return compensateOccurrenceDelete(target, targetIds, activeFacts, projection);
      case "occurrence-move":
        return compensateMove(target, activeFacts, projection);
    }
  }
  return null;
}

export function compensateNodeCreate(
  target: ContributionFact,
  targetIds: ReadonlySet<string>,
  activeFacts: readonly ContributionFact[],
  projection: ScopedProjection,
): CompensationStep {
  const mutation = target.body.mutation;
  const location =
    mutation.kind === "node-create" || mutation.kind === "node-restore"
      ? nodeLocation(projection.identity.workspaceNodeId, projection, mutation.nodeId)
      : "absent";
  const ownedByDetachedRelation =
    (mutation.kind === "node-create" || mutation.kind === "node-restore") &&
    location === "absent" &&
    projection.nodeOwners[mutation.nodeId] != null;
  if (
    (mutation.kind !== "node-create" && mutation.kind !== "node-restore") ||
    (location !== "active" && !ownedByDetachedRelation)
  ) {
    return noCompensation();
  }
  if (hasAlternateNodeCreator(target, targetIds, activeFacts)) {
    return noCompensation();
  }
  const reverseDependencies = [...deriveSupport(activeFacts)].filter(
    ([id, supports]) => !targetIds.has(id) && supports.includes(target.id),
  );
  if (reverseDependencies.length > 0) {
    return { kind: "stale", reason: "Deleting the created Node would remove later work" };
  }
  if (mutation.kind === "node-restore") {
    return { kind: "ready", mutations: [{ kind: "node-delete", nodeId: mutation.nodeId }] };
  }
  const ownerNodeId = projection.nodeOwners[mutation.nodeId];
  const trashNodeId = projection.workspaceSystemNodes.trash;
  const candidates = Object.values(projection.occurrences).filter((candidate) => candidate.nodeId === mutation.nodeId);
  const occurrence = candidates.find((candidate) => candidate.parentNodeId === ownerNodeId) ?? candidates[0];
  if (!ownerNodeId || !trashNodeId || !occurrence) {
    return { kind: "stale", reason: "Created Node has no owning structure to move into Trash" };
  }
  return {
    kind: "ready",
    mutations: [
      { kind: "node-delete", nodeId: mutation.nodeId },
      {
        kind: "node-owner-set",
        nodeId: mutation.nodeId,
        ownerNodeId: trashNodeId,
        previousOwnerNodeId: ownerNodeId,
      },
      {
        kind: "occurrence-move",
        occurrenceId: occurrence.occurrenceId,
        parentNodeId: trashNodeId,
        anchor: { after: null, before: null, affinity: "after", fallback: "end" },
      },
    ],
  };
}

export function compensateNodeDelete(
  target: ContributionFact,
  targetIds: ReadonlySet<string>,
  activeFacts: readonly ContributionFact[],
  projection: ScopedProjection,
): CompensationStep {
  const mutation = target.body.mutation;
  if (
    mutation.kind !== "node-delete" ||
    nodeLocation(projection.identity.workspaceNodeId, projection, mutation.nodeId) !== "trash"
  ) {
    return noCompensation();
  }
  const independentDelete = activeFacts.some(
    (fact) =>
      !targetIds.has(fact.id) &&
      fact.body.mutation.kind === "node-delete" &&
      fact.body.mutation.nodeId === mutation.nodeId &&
      !activeFacts.some(
        (restore) => restore.body.mutation.kind === "node-restore" && restore.body.mutation.deletionFactId === fact.id,
      ),
  );
  return independentDelete
    ? { kind: "stale", reason: "Node has an independent uncompensated deletion" }
    : {
        kind: "ready",
        mutations: [{ kind: "node-restore", nodeId: mutation.nodeId, deletionFactId: target.id }],
      };
}

export function compensateOccurrenceCreate(
  target: ContributionFact,
  targetIds: ReadonlySet<string>,
  activeFacts: readonly ContributionFact[],
  projection: ScopedProjection,
): CompensationStep {
  const mutation = target.body.mutation;
  const nodeId = mutation.kind === "occurrence-create" ? mutation.nodeId : undefined;
  if (
    (mutation.kind !== "occurrence-create" && mutation.kind !== "occurrence-restore") ||
    !projection.occurrences[mutation.occurrenceId] ||
    hasIndependentOccurrenceWork(target, targetIds, activeFacts) ||
    (nodeId !== undefined &&
      activeFacts.some(
        (fact) =>
          targetIds.has(fact.id) && fact.body.mutation.kind === "node-create" && fact.body.mutation.nodeId === nodeId,
      ))
  ) {
    return noCompensation();
  }
  return {
    kind: "ready",
    mutations: [
      {
        kind: "occurrence-delete",
        occurrenceId: mutation.occurrenceId,
        previousParentNodeId: projection.occurrences[mutation.occurrenceId]?.parentNodeId,
        previousAnchor: occurrenceAnchor(projection, mutation.occurrenceId),
      },
    ],
  };
}

export function compensateOccurrenceDelete(
  target: ContributionFact,
  targetIds: ReadonlySet<string>,
  activeFacts: readonly ContributionFact[],
  projection: ScopedProjection,
): CompensationStep {
  const mutation = occurrenceDeletion(target);
  if (!mutation || projection.occurrences[mutation.occurrenceId]) {
    return noCompensation();
  }
  const independentDelete = activeFacts.some(
    (fact) =>
      !targetIds.has(fact.id) &&
      occurrenceDeletion(fact)?.occurrenceId === mutation.occurrenceId &&
      !activeFacts.some(
        (restore) =>
          restore.body.mutation.kind === "occurrence-restore" && restore.body.mutation.deletionFactId === fact.id,
      ),
  );
  if (independentDelete || mutation.previousAnchor === undefined) {
    return { kind: "stale", reason: "Occurrence deletion cannot be safely restored" };
  }
  const previousParent = mutation.previousParentNodeId;
  if (!previousParent || !projection.nodes[previousParent]) {
    return { kind: "stale", reason: "Occurrence deletion previous parent no longer exists" };
  }
  return {
    kind: "ready",
    mutations: [
      {
        kind: "occurrence-restore",
        occurrenceId: mutation.occurrenceId,
        deletionFactId: target.id,
        parentNodeId: previousParent,
        anchor: mutation.previousAnchor,
      },
    ],
  };
}

function occurrenceDeletion(fact: ContributionFact): Readonly<{
  occurrenceId: string;
  previousParentNodeId?: string | null;
  previousAnchor?: SequenceAnchor;
}> | null {
  const mutation = fact.body.mutation;
  if (mutation.kind === "occurrence-delete") {
    return mutation;
  }
  if (mutation.kind === "field-value-delete") {
    return { ...mutation, occurrenceId: mutation.valueOccurrenceId };
  }
  return mutation.kind === "materialized-field-delete"
    ? { ...mutation, occurrenceId: mutation.fieldOccurrenceId }
    : null;
}

export function compensateMove(
  target: ContributionFact,
  activeFacts: readonly ContributionFact[],
  projection: ScopedProjection,
): CompensationStep {
  const mutation = target.body.mutation;
  if (mutation.kind !== "occurrence-move") {
    return noCompensation();
  }
  const occurrence = projection.occurrences[mutation.occurrenceId];
  const laterRestore = activeFacts.some(
    (fact) =>
      compareFacts(target, fact) < 0 &&
      fact.body.mutation.kind === "occurrence-restore" &&
      fact.body.mutation.occurrenceId === mutation.occurrenceId,
  );
  if (laterRestore) {
    return noCompensation();
  }
  const winner = activeFacts
    .filter(
      (fact) =>
        fact.body.mutation.kind === "occurrence-move" &&
        fact.body.mutation.occurrenceId === mutation.occurrenceId &&
        fact.body.mutation.parentNodeId === occurrence?.parentNodeId,
    )
    .sort(compareFacts)
    .at(-1);
  if (winner?.id !== target.id || !occurrence || occurrence.parentNodeId !== mutation.parentNodeId) {
    return noCompensation();
  }
  if (mutation.previousAnchor === undefined || mutation.previousParentNodeId === undefined) {
    return { kind: "stale", reason: "Move lacks its stable previous placement" };
  }
  if (!projection.nodes[mutation.previousParentNodeId]) {
    return { kind: "stale", reason: "Move previous parent no longer exists" };
  }
  return {
    kind: "ready",
    mutations: [
      {
        kind: "occurrence-move",
        occurrenceId: mutation.occurrenceId,
        parentNodeId: mutation.previousParentNodeId,
        anchor: mutation.previousAnchor,
      },
    ],
  };
}
