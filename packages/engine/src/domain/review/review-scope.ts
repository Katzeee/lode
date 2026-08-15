import { canonicalJson, fieldContentDeletionOccurrenceId, type FieldContentDeletionMutation } from "../fact/index.js";

export type ReviewScopeContext = Readonly<{
  occurrenceNodeId(occurrenceId: string): string | null;
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

export function fieldContentDeletionScopes(mutation: FieldContentDeletionMutation): readonly string[] {
  return [
    reviewScope("field-content", mutation.ownerNodeId, mutation.fieldDefinitionId),
    associatedNodeScope(mutation.ownerNodeId),
    associatedNodeScope(mutation.fieldDefinitionId),
    mutation.kind === "field-value-delete"
      ? reviewScope("associated-occurrence", fieldContentDeletionOccurrenceId(mutation))
      : associatedNodeScope(mutation.fieldNodeId),
  ];
}
