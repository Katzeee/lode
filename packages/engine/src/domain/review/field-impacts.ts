import { impactAddress, type ScopedProjectionGeneration } from "../reconcile/index.js";

export function addAffectedFieldImpacts(
  impacts: Set<string>,
  ownerNodeId: string,
  fieldDefinitionId: string,
  generation: ScopedProjectionGeneration,
): void {
  for (const field of [
    ...(generation.origin.materializedFields[ownerNodeId] ?? []),
    ...(generation.review.materializedFields[ownerNodeId] ?? []),
  ]) {
    if (field.fieldDefinitionId === fieldDefinitionId) {
      impacts.add(impactAddress("materialized-field", ownerNodeId, fieldDefinitionId));
      impacts.add(field.fieldNodeId);
      impacts.add(field.fieldOccurrenceId);
    }
  }
}
