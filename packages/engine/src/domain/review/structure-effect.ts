import {
  canonicalJson,
  isOccurrenceMutation,
  stableStringCompare,
  type Mutation,
  type OccurrenceMutation,
  type SequenceAnchor,
} from "../fact/index.js";
import type { ScopedProjection, ScopedProjectionGeneration } from "../reconcile/index.js";

export type StructuralOccurrenceMutation =
  OccurrenceMutation | Extract<Mutation, { kind: "field-value-delete" | "materialized-field-delete" }>;

export function occurrenceIdsForNode(generation: ScopedProjectionGeneration, nodeId: string): readonly string[] {
  return [...Object.values(generation.origin.occurrences), ...Object.values(generation.review.occurrences)]
    .filter((occurrence) => occurrence.nodeId === nodeId)
    .map((occurrence) => occurrence.occurrenceId)
    .filter((id, index, all) => all.indexOf(id) === index)
    .sort(stableStringCompare);
}

export function structureEffect(
  occurrenceId: string,
  generation: ScopedProjectionGeneration,
  anchor: SequenceAnchor | null,
) {
  const origin = generation.origin.occurrences[occurrenceId];
  const review = generation.review.occurrences[occurrenceId];
  return {
    kind: "structure" as const,
    occurrenceId,
    originPresent: origin !== undefined,
    reviewPresent: review !== undefined,
    originParentId: origin?.parentNodeId ?? null,
    reviewParentId: review?.parentNodeId ?? null,
    anchor,
    originRelation: origin && anchor ? placementRelation(generation.origin, occurrenceId, anchor) : null,
    reviewRelation: review && anchor ? placementRelation(generation.review, occurrenceId, anchor) : null,
  };
}

export function structureEffectChanged(effect: ReturnType<typeof structureEffect>): boolean {
  return (
    canonicalJson([effect.originPresent, effect.originParentId, effect.originRelation]) !==
    canonicalJson([effect.reviewPresent, effect.reviewParentId, effect.reviewRelation])
  );
}

export function isStructuralOccurrenceMutation(mutation: Mutation): mutation is StructuralOccurrenceMutation {
  return (
    isOccurrenceMutation(mutation) ||
    mutation.kind === "field-value-delete" ||
    mutation.kind === "materialized-field-delete"
  );
}

export function structuralOccurrenceId(mutation: StructuralOccurrenceMutation): string {
  if ("occurrenceId" in mutation) {
    return mutation.occurrenceId;
  }
  return mutation.kind === "field-value-delete" ? mutation.valueOccurrenceId : mutation.fieldOccurrenceId;
}

export function mutationAnchor(mutation: StructuralOccurrenceMutation): SequenceAnchor | null {
  switch (mutation.kind) {
    case "occurrence-create":
    case "occurrence-restore":
    case "occurrence-move":
      return mutation.anchor;
    case "occurrence-delete":
    case "field-value-delete":
    case "materialized-field-delete":
      return mutation.previousAnchor ?? null;
  }
}

function placementRelation(projection: ScopedProjection, occurrenceId: string, anchor: SequenceAnchor) {
  const occurrence = projection.occurrences[occurrenceId];
  if (!occurrence) {
    return null;
  }
  const siblings = projection.children[occurrence.parentNodeId] ?? [];
  const index = siblings.indexOf(occurrenceId);
  return {
    parentMatches: true,
    afterEndpoint: endpointRelation(siblings, index, anchor.after),
    beforeEndpoint: endpointRelation(siblings, index, anchor.before),
  };
}

function endpointRelation(
  siblings: readonly string[],
  targetIndex: number,
  endpoint: string | null,
): "before" | "after" | "missing" | null {
  if (endpoint === null) {
    return null;
  }
  const endpointIndex = siblings.indexOf(endpoint);
  return endpointIndex < 0 ? "missing" : targetIndex < endpointIndex ? "before" : "after";
}
