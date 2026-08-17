import {
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  FIELD_INTRINSIC_NODE_TYPE,
  fieldDefinitionEndpointOccurrenceId,
  type ContributionFact,
  type FactSnapshot,
} from "../fact/index.js";
import { deriveActivation } from "../activation/index.js";
import { nodeLocation, type Projection } from "../reconcile/index.js";

export function validateFieldBindings(snapshot: FactSnapshot, projection: Projection): void {
  const activeFieldNodeIds = Object.values(projection.nodes).flatMap((node) =>
    node.intrinsicNodeType === FIELD_INTRINSIC_NODE_TYPE &&
    nodeLocation(projection.identity.workspaceNodeId, projection, node.nodeId) === "active"
      ? [node.nodeId]
      : [],
  );
  const boundFieldNodeIds = new Set(
    Object.values(projection.materializedFields).flatMap((fields) => fields.map((field) => field.fieldNodeId)),
  );
  for (const fields of Object.values(projection.templateFields)) {
    fields.forEach((field) => boundFieldNodeIds.add(field.templateFieldNodeId));
  }
  const activation = deriveActivation(snapshot.facts, projection.perspective);
  for (const fact of snapshot.facts) {
    if (
      fact.body.kind === "contribution" &&
      activation.activeContributionIds.has(fact.id) &&
      fact.body.mutation.kind === "field-materialize" &&
      hasMaterializedFieldStructure(projection, fact.body.mutation)
    ) {
      boundFieldNodeIds.add(fact.body.mutation.fieldNodeId);
    }
  }
  const unboundFieldNodeId = activeFieldNodeIds.find((nodeId) => !boundFieldNodeIds.has(nodeId));
  if (unboundFieldNodeId) {
    throw new Error(`Field Node has no Field Definition binding: ${unboundFieldNodeId}`);
  }
}

function hasMaterializedFieldStructure(
  projection: Projection,
  mutation: Extract<ContributionFact["body"]["mutation"], { kind: "field-materialize" }>,
): boolean {
  const fieldOccurrence = projection.occurrences[mutation.fieldOccurrenceId];
  const definitionOccurrence = projection.occurrences[fieldDefinitionEndpointOccurrenceId(mutation.fieldOccurrenceId)];
  return (
    projection.nodes[mutation.fieldNodeId]?.intrinsicNodeType === FIELD_INTRINSIC_NODE_TYPE &&
    projection.nodes[mutation.fieldDefinitionId]?.intrinsicNodeType === FIELD_DEFINITION_INTRINSIC_NODE_TYPE &&
    projection.nodeOwners[mutation.fieldNodeId] === mutation.ownerNodeId &&
    fieldOccurrence?.nodeId === mutation.fieldNodeId &&
    fieldOccurrence.parentNodeId === mutation.ownerNodeId &&
    definitionOccurrence?.nodeId === mutation.fieldDefinitionId &&
    definitionOccurrence.parentNodeId === mutation.fieldNodeId &&
    projection.childOccurrences[mutation.fieldNodeId]?.[0] === definitionOccurrence.occurrenceId
  );
}
