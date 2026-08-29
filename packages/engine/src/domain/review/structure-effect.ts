import {
  canonicalJson,
  isPlacementAction,
  stableStringCompare,
  type AuthoredAction,
  type PlacementAction,
  type SequenceAnchor,
} from "../fact/index.js";
import type { InterpretedProjection, InterpretedProjectionGeneration } from "../reconcile/index.js";

export type StructuralPlacementAction = PlacementAction | Extract<AuthoredAction, { kind: "field-value-remove" }>;

export function occurrenceIdsForNode(generation: InterpretedProjectionGeneration, nodeId: string): readonly string[] {
  return [...Object.values(generation.origin.occurrences), ...Object.values(generation.review.occurrences)]
    .filter((occurrence) => occurrence.nodeId === nodeId)
    .map((occurrence) => occurrence.occurrenceId)
    .filter((id, index, all) => all.indexOf(id) === index)
    .sort(stableStringCompare);
}

export function structureEffect(
  occurrenceId: string,
  generation: InterpretedProjectionGeneration,
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

export function isStructuralPlacementAction(action: AuthoredAction): action is StructuralPlacementAction {
  return isPlacementAction(action) || action.kind === "field-value-remove";
}

export function structuralOccurrenceId(action: StructuralPlacementAction): string {
  if ("placementId" in action) {
    return action.placementId;
  }
  return action.valuePlacementId;
}

export function actionAnchor(action: StructuralPlacementAction): SequenceAnchor | null {
  switch (action.kind) {
    case "placement-create":
    case "placement-move":
      return action.anchor;
    case "placement-remove":
    case "field-value-remove":
      return null;
  }
}

function placementRelation(projection: InterpretedProjection, occurrenceId: string, anchor: SequenceAnchor) {
  const occurrence = projection.occurrences[occurrenceId];
  if (!occurrence) {
    return null;
  }
  const siblings = projection.childOccurrences[occurrence.parentNodeId] ?? [];
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
