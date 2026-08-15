import { FIELD_DEFINITION_NODE_TYPE, SCHEMA_NODE_TYPE } from "../fact/index.js";
import { impactAddress, type ScopedProjectionGeneration } from "../reconcile/index.js";
import { addAffectedFieldImpacts } from "./field-impacts.js";

export function addDefinitionLifecycleImpacts(
  impacts: Set<string>,
  definitionId: string,
  generation: ScopedProjectionGeneration,
): void {
  const originNodeType = generation.origin.nodeStatuses[definitionId]?.nodeType;
  const reviewNodeType = generation.review.nodeStatuses[definitionId]?.nodeType;
  const isField =
    originNodeType === FIELD_DEFINITION_NODE_TYPE ||
    reviewNodeType === FIELD_DEFINITION_NODE_TYPE ||
    [generation.origin, generation.review].some((projection) =>
      Object.values(projection.effectiveFields).some((fields) =>
        fields.some((field) => field.fieldDefinitionId === definitionId),
      ),
    );
  const isSchema =
    originNodeType === SCHEMA_NODE_TYPE ||
    reviewNodeType === SCHEMA_NODE_TYPE ||
    [generation.origin, generation.review].some(
      (projection) =>
        projection.schemaFields[definitionId] !== undefined ||
        projection.schemaSearchMembers[definitionId] !== undefined ||
        Object.values(projection.schemaApplications).some((schemas) => schemas.includes(definitionId)),
    );
  if (isField) {
    for (const ownerNodeId of projectionNodeIds(generation)) {
      addAffectedFieldImpacts(impacts, ownerNodeId, definitionId, generation);
    }
  }
  if (isSchema) {
    for (const ownerNodeId of schemaInstanceNodeIds(generation, definitionId)) {
      impacts.add(impactAddress("schema-membership", definitionId, ownerNodeId));
      const fieldDefinitionIds = new Set([
        ...(generation.origin.effectiveFields[ownerNodeId] ?? []).map((field) => field.fieldDefinitionId),
        ...(generation.review.effectiveFields[ownerNodeId] ?? []).map((field) => field.fieldDefinitionId),
      ]);
      for (const fieldDefinitionId of fieldDefinitionIds) {
        addAffectedFieldImpacts(impacts, ownerNodeId, fieldDefinitionId, generation);
      }
    }
  }
}

function projectionNodeIds(generation: ScopedProjectionGeneration): readonly string[] {
  return [...new Set([...Object.keys(generation.origin.nodes), ...Object.keys(generation.review.nodes)])];
}

function schemaInstanceNodeIds(generation: ScopedProjectionGeneration, schemaId: string): ReadonlySet<string> {
  return new Set(
    [generation.origin, generation.review].flatMap((projection) => {
      const memberSchemas = new Set([schemaId, ...(projection.schemaSearchMembers[schemaId] ?? [])]);
      return Object.entries(projection.schemaApplications).flatMap(([nodeId, schemaIds]) =>
        schemaIds.some((applied) => memberSchemas.has(applied)) ? [nodeId] : [],
      );
    }),
  );
}
