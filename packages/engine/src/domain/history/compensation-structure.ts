import { compareFacts, type ContributionFact } from "../fact/index.js";
import type { Projection } from "../reconcile/index.js";
import { deriveSupport } from "../reconcile/support.js";
import { hasAlternateNodeCreator, hasIndependentOccurrenceWork } from "./compensation-lifecycle.js";
import { noCompensation, type CompensationStep } from "./compensation-types.js";

export function compensateNodeCreate(
  target: ContributionFact,
  targetIds: ReadonlySet<string>,
  activeFacts: readonly ContributionFact[],
  projection: Projection,
): CompensationStep {
  const mutation = target.body.mutation;
  if (
    (mutation.kind !== "node-create" && mutation.kind !== "node-restore") ||
    !projection.nodes[mutation.nodeId]
  ) {
    return noCompensation();
  }
  if (hasAlternateNodeCreator(target, targetIds, activeFacts)) {
    return noCompensation();
  }
  const reverseDependencies = [...deriveSupport(activeFacts)].filter(
    ([id, supports]) => !targetIds.has(id) && supports.includes(target.id),
  );
  return reverseDependencies.length > 0
    ? { kind: "stale", reason: "Deleting the created Node would remove later work" }
    : { kind: "ready", mutations: [{ kind: "node-delete", nodeId: mutation.nodeId }] };
}

export function compensateNodeDelete(
  target: ContributionFact,
  targetIds: ReadonlySet<string>,
  activeFacts: readonly ContributionFact[],
  projection: Projection,
): CompensationStep {
  const mutation = target.body.mutation;
  if (mutation.kind !== "node-delete" || projection.nodes[mutation.nodeId]) {
    return noCompensation();
  }
  const independentDelete = activeFacts.some(
    (fact) =>
      !targetIds.has(fact.id) &&
      fact.body.mutation.kind === "node-delete" &&
      fact.body.mutation.nodeId === mutation.nodeId &&
      !activeFacts.some(
        (restore) =>
          restore.body.mutation.kind === "node-restore" &&
          restore.body.mutation.deletionFactId === fact.id,
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
  projection: Projection,
): CompensationStep {
  const mutation = target.body.mutation;
  if (
    (mutation.kind !== "occurrence-create" && mutation.kind !== "occurrence-restore") ||
    !projection.occurrences[mutation.occurrenceId] ||
    hasIndependentOccurrenceWork(target, targetIds, activeFacts)
  ) {
    return noCompensation();
  }
  return {
    kind: "ready",
    mutations: [
      {
        kind: "occurrence-delete",
        occurrenceId: mutation.occurrenceId,
        childPolicy: "rehome",
        previousParentOccurrenceId:
          projection.occurrences[mutation.occurrenceId]?.parentOccurrenceId ?? null,
        previousAnchor: occurrenceAnchor(projection, mutation.occurrenceId),
      },
    ],
  };
}

export function compensateOccurrenceDelete(
  target: ContributionFact,
  targetIds: ReadonlySet<string>,
  activeFacts: readonly ContributionFact[],
  projection: Projection,
): CompensationStep {
  const mutation = target.body.mutation;
  if (mutation.kind !== "occurrence-delete" || projection.occurrences[mutation.occurrenceId]) {
    return noCompensation();
  }
  const independentDelete = activeFacts.some(
    (fact) =>
      !targetIds.has(fact.id) &&
      fact.body.mutation.kind === "occurrence-delete" &&
      fact.body.mutation.occurrenceId === mutation.occurrenceId &&
      !activeFacts.some(
        (restore) =>
          restore.body.mutation.kind === "occurrence-restore" &&
          restore.body.mutation.deletionFactId === fact.id,
      ),
  );
  if (independentDelete || mutation.previousAnchor === undefined) {
    return { kind: "stale", reason: "Occurrence deletion cannot be safely restored" };
  }
  const previousParent = mutation.previousParentOccurrenceId ?? null;
  if (previousParent !== null && !projection.occurrences[previousParent]) {
    return { kind: "stale", reason: "Occurrence deletion previous parent no longer exists" };
  }
  return {
    kind: "ready",
    mutations: [
      {
        kind: "occurrence-restore",
        occurrenceId: mutation.occurrenceId,
        deletionFactId: target.id,
        parentOccurrenceId: previousParent,
        anchor: mutation.previousAnchor,
      },
    ],
  };
}

export function compensateMove(
  target: ContributionFact,
  activeFacts: readonly ContributionFact[],
  projection: Projection,
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
        fact.body.mutation.parentOccurrenceId === occurrence?.parentOccurrenceId,
    )
    .sort(compareFacts)
    .at(-1);
  if (
    winner?.id !== target.id ||
    !occurrence ||
    occurrence.parentOccurrenceId !== mutation.parentOccurrenceId
  ) {
    return noCompensation();
  }
  if (mutation.previousAnchor === undefined || mutation.previousParentOccurrenceId === undefined) {
    return { kind: "stale", reason: "Move lacks its stable previous placement" };
  }
  if (
    mutation.previousParentOccurrenceId !== null &&
    !projection.occurrences[mutation.previousParentOccurrenceId]
  ) {
    return { kind: "stale", reason: "Move previous parent no longer exists" };
  }
  return {
    kind: "ready",
    mutations: [
      {
        kind: "occurrence-move",
        occurrenceId: mutation.occurrenceId,
        parentOccurrenceId: mutation.previousParentOccurrenceId,
        anchor: mutation.previousAnchor,
        previousParentOccurrenceId: mutation.parentOccurrenceId,
        previousAnchor: occurrenceAnchor(projection, mutation.occurrenceId),
      },
    ],
  };
}

export function compensateCanonical(
  target: ContributionFact,
  activeFacts: readonly ContributionFact[],
  projection: Projection,
): CompensationStep {
  const mutation = target.body.mutation;
  if (mutation.kind !== "canonical-occurrence-set") {
    return noCompensation();
  }
  const winner = activeFacts
    .filter(
      (fact) =>
        fact.body.mutation.kind === "canonical-occurrence-set" &&
        fact.body.mutation.nodeId === mutation.nodeId,
    )
    .sort(compareFacts)
    .at(-1);
  if (
    winner?.id !== target.id ||
    projection.canonicalOccurrences[mutation.nodeId] !== mutation.occurrenceId
  ) {
    return noCompensation();
  }
  if (
    !mutation.previousOccurrenceId ||
    projection.occurrences[mutation.previousOccurrenceId]?.nodeId !== mutation.nodeId
  ) {
    return { kind: "stale", reason: "Previous canonical Occurrence is no longer valid" };
  }
  return {
    kind: "ready",
    mutations: [
      {
        kind: "canonical-occurrence-set",
        nodeId: mutation.nodeId,
        occurrenceId: mutation.previousOccurrenceId,
        previousOccurrenceId: mutation.occurrenceId,
      },
    ],
  };
}

export function occurrenceAnchor(projection: Projection, occurrenceId: string) {
  const occurrence = projection.occurrences[occurrenceId];
  const siblings = projection.children[occurrence?.parentOccurrenceId ?? "$root"] ?? [];
  const index = siblings.indexOf(occurrenceId);
  return {
    after: index > 0 ? (siblings[index - 1] ?? null) : null,
    before: index >= 0 && index + 1 < siblings.length ? (siblings[index + 1] ?? null) : null,
    affinity: "after" as const,
    fallback: index <= 0 ? ("start" as const) : ("end" as const),
  };
}
