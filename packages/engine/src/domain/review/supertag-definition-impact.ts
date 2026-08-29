import { FIELD_DEFINITION_INTRINSIC_NODE_TYPE, SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE } from "../fact/index.js";
import { impactAddress, type InterpretedProjectionGeneration } from "../reconcile/index.js";
import { addAffectedFieldImpacts } from "./field-impacts.js";

export function addDefinitionLifecycleImpacts(
  impacts: Set<string>,
  definitionId: string,
  generation: InterpretedProjectionGeneration,
): void {
  const originIntrinsicNodeType = generation.origin.nodes[definitionId]?.intrinsicNodeType;
  const reviewIntrinsicNodeType = generation.review.nodes[definitionId]?.intrinsicNodeType;
  const isField =
    originIntrinsicNodeType === FIELD_DEFINITION_INTRINSIC_NODE_TYPE ||
    reviewIntrinsicNodeType === FIELD_DEFINITION_INTRINSIC_NODE_TYPE ||
    [generation.origin, generation.review].some((projection) =>
      Object.values(projection.materializedFields).some((fields) =>
        fields.some((field) => field.fieldDefinitionId === definitionId),
      ),
    );
  const isSupertag =
    originIntrinsicNodeType === SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE ||
    reviewIntrinsicNodeType === SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE ||
    [generation.origin, generation.review].some(
      (projection) =>
        projection.supertagInstanceSupertags[definitionId] !== undefined ||
        Object.values(projection.supertagApplications).some((applications) =>
          applications.some((application) => application.supertagId === definitionId),
        ),
    );
  if (isField) {
    for (const ownerNodeId of projectionNodeIds(generation)) {
      addAffectedFieldImpacts(impacts, ownerNodeId, definitionId, generation);
    }
  }
  if (isSupertag) {
    for (const ownerNodeId of supertagInstanceNodeIds(generation, definitionId)) {
      impacts.add(impactAddress("supertag-membership", definitionId, ownerNodeId));
    }
  }
}

function projectionNodeIds(generation: InterpretedProjectionGeneration): readonly string[] {
  return [...new Set([...Object.keys(generation.origin.nodes), ...Object.keys(generation.review.nodes)])];
}

function supertagInstanceNodeIds(generation: InterpretedProjectionGeneration, supertagId: string): ReadonlySet<string> {
  return new Set(
    [generation.origin, generation.review].flatMap((projection) => {
      const instanceSupertags = new Set([supertagId, ...(projection.supertagInstanceSupertags[supertagId] ?? [])]);
      return Object.entries(projection.supertagApplications).flatMap(([nodeId, applications]) =>
        applications.some((application) => instanceSupertags.has(application.supertagId)) ? [nodeId] : [],
      );
    }),
  );
}
