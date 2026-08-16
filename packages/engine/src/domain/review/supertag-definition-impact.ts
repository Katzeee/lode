import { FIELD_DEFINITION_NODE_TYPE, SUPERTAG_DEFINITION_NODE_TYPE } from "../fact/index.js";
import { impactAddress, type ScopedProjectionGeneration } from "../reconcile/index.js";
import { addAffectedFieldImpacts } from "./field-impacts.js";

export function addDefinitionLifecycleImpacts(
  impacts: Set<string>,
  definitionId: string,
  generation: ScopedProjectionGeneration,
): void {
  const originNodeType = generation.origin.nodes[definitionId]?.nodeType;
  const reviewNodeType = generation.review.nodes[definitionId]?.nodeType;
  const isField =
    originNodeType === FIELD_DEFINITION_NODE_TYPE ||
    reviewNodeType === FIELD_DEFINITION_NODE_TYPE ||
    [generation.origin, generation.review].some((projection) =>
      Object.values(projection.effectiveFields).some((fields) =>
        fields.some((field) => field.fieldDefinitionId === definitionId),
      ),
    );
  const isSupertag =
    originNodeType === SUPERTAG_DEFINITION_NODE_TYPE ||
    reviewNodeType === SUPERTAG_DEFINITION_NODE_TYPE ||
    [generation.origin, generation.review].some(
      (projection) =>
        projection.supertagFields[definitionId] !== undefined ||
        projection.supertagInstanceSupertags[definitionId] !== undefined ||
        Object.values(projection.supertagApplications).some((supertags) => supertags.includes(definitionId)),
    );
  if (isField) {
    for (const ownerNodeId of projectionNodeIds(generation)) {
      addAffectedFieldImpacts(impacts, ownerNodeId, definitionId, generation);
    }
  }
  if (isSupertag) {
    for (const ownerNodeId of supertagInstanceNodeIds(generation, definitionId)) {
      impacts.add(impactAddress("supertag-membership", definitionId, ownerNodeId));
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

function supertagInstanceNodeIds(generation: ScopedProjectionGeneration, supertagId: string): ReadonlySet<string> {
  return new Set(
    [generation.origin, generation.review].flatMap((projection) => {
      const instanceSupertags = new Set([supertagId, ...(projection.supertagInstanceSupertags[supertagId] ?? [])]);
      return Object.entries(projection.supertagApplications).flatMap(([nodeId, supertagIds]) =>
        supertagIds.some((applied) => instanceSupertags.has(applied)) ? [nodeId] : [],
      );
    }),
  );
}
