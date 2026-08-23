import { FIELD_DEFINITION_INTRINSIC_NODE_TYPE, type AuthoredAction } from "../fact/index.js";
import { definitionNodeState } from "./definition-node.js";
import { isActiveNode } from "./node-graph.js";
import type { Projection } from "./projection-types.js";

type MaterializedFieldProjection = Pick<
  Projection,
  | "identity"
  | "materializedFields"
  | "nodes"
  | "occurrences"
  | "childOccurrences"
  | "nodeOwners"
  | "workspaceSystemNodes"
>;

function materializedFieldProblem(
  authoredAction: Extract<AuthoredAction, { kind: "field-materialize" }>,
  projection: MaterializedFieldProjection,
): string | null {
  if (
    definitionNodeState(projection, authoredAction.fieldDefinitionId, FIELD_DEFINITION_INTRINSIC_NODE_TYPE) !== "active"
  ) {
    return `Field Definition type is absent: ${authoredAction.fieldDefinitionId}`;
  }
  for (const [nodeId, label] of [
    [authoredAction.ownerNodeId, "Field owner"],
    [authoredAction.fieldDefinitionId, "Field Definition"],
    [authoredAction.fieldNodeId, "Materialized Field"],
  ] as const) {
    if (!isActiveNode(projection.identity.workspaceNodeId, projection, nodeId)) {
      return `${label} Node does not exist: ${nodeId}`;
    }
  }
  const occurrence = projection.occurrences[authoredAction.fieldOccurrenceId];
  if (occurrence?.nodeId !== authoredAction.fieldNodeId) {
    return "Materialized Field Occurrence does not present the Field Node";
  }
  if (occurrence.parentNodeId !== authoredAction.ownerNodeId) {
    return "Materialized Field Occurrence is not stored under its owner Node";
  }
  for (const fields of Object.values(projection.materializedFields)) {
    for (const field of fields) {
      if (!sameMaterialization(field, authoredAction) && identitiesOverlap(field, authoredAction)) {
        return "Materialized Field identity is already bound";
      }
    }
  }
  return null;
}

export function assertMaterializedField(
  authoredAction: Extract<AuthoredAction, { kind: "field-materialize" }>,
  projection: MaterializedFieldProjection,
): void {
  const problem = materializedFieldProblem(authoredAction, projection);
  if (problem) {
    throw new Error(problem);
  }
}

function sameMaterialization(
  field: Projection["materializedFields"][string][number],
  authoredAction: Extract<AuthoredAction, { kind: "field-materialize" }>,
): boolean {
  return (
    field.ownerNodeId === authoredAction.ownerNodeId &&
    field.fieldDefinitionId === authoredAction.fieldDefinitionId &&
    field.fieldNodeId === authoredAction.fieldNodeId &&
    field.fieldOccurrenceId === authoredAction.fieldOccurrenceId
  );
}

function identitiesOverlap(
  field: Projection["materializedFields"][string][number],
  authoredAction: Extract<AuthoredAction, { kind: "field-materialize" }>,
): boolean {
  return (
    (field.ownerNodeId === authoredAction.ownerNodeId &&
      field.fieldDefinitionId === authoredAction.fieldDefinitionId) ||
    field.fieldNodeId === authoredAction.fieldNodeId ||
    field.fieldOccurrenceId === authoredAction.fieldOccurrenceId
  );
}
