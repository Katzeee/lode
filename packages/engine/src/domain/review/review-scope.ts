import { canonicalJson, type FieldContentRemovalAction } from "../fact/index.js";

export type ReviewScopeContext = Readonly<{
  occurrence(occurrenceId: string): Readonly<{ nodeId: string; parentNodeId: string }> | null;
}>;

export function reviewScope(...parts: readonly unknown[]): string {
  return canonicalJson(parts);
}

export function associatedNodeScope(nodeId: string): string {
  return reviewScope("associated-node", nodeId);
}

export function associatedOccurrenceScopes(occurrenceId: string, nodeId?: string): readonly string[] {
  return [reviewScope("associated-occurrence", occurrenceId), ...(nodeId ? [associatedNodeScope(nodeId)] : [])];
}

export function structureParentScope(parentNodeId: string): string {
  return reviewScope("structure-parent", parentNodeId);
}

export function fieldContentRemovalScopes(
  action: FieldContentRemovalAction,
  context: ReviewScopeContext,
): readonly string[] {
  if (action.kind === "field-value-remove") {
    const placement = context.occurrence(action.valuePlacementId);
    return [
      reviewScope("associated-occurrence", action.valuePlacementId),
      ...(placement ? [associatedNodeScope(placement.nodeId), associatedNodeScope(placement.parentNodeId)] : []),
    ];
  }
  return [
    reviewScope("field-content", action.ownerNodeId, action.fieldDefinitionId),
    associatedNodeScope(action.ownerNodeId),
    associatedNodeScope(action.fieldDefinitionId),
  ];
}
