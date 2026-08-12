import { canonicalJson } from "../fact/index.js";
import { impactAddress, type Projection, type ProjectionGeneration } from "../reconcile/index.js";

export function addAffectedFieldImpacts(
  impacts: Set<string>,
  ownerNodeId: string,
  fieldDefinitionId: string,
  generation: ProjectionGeneration,
): void {
  const origin = effectiveField(generation.origin, ownerNodeId, fieldDefinitionId);
  const review = effectiveField(generation.review, ownerNodeId, fieldDefinitionId);
  if (canonicalJson(origin) !== canonicalJson(review)) {
    impacts.add(
      impactAddress(
        "effective-field",
        ownerNodeId,
        fieldDefinitionId,
        canonicalJson({ origin, review }),
      ),
    );
  }
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

function effectiveField(projection: Projection, nodeId: string, fieldDefinitionId: string) {
  return (
    projection.effectiveFields[nodeId]?.find(
      (field) => field.fieldDefinitionId === fieldDefinitionId,
    ) ?? null
  );
}
