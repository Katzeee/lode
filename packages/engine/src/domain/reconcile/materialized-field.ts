import {
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  materializedFieldNodeId,
  materializedFieldOccurrenceId,
  type AuthoredAction,
} from "../fact/index.js";
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
  const fieldNodeId = materializedFieldNodeId(authoredAction.ownerNodeId, authoredAction.fieldDefinitionId);
  const fieldOccurrenceId = materializedFieldOccurrenceId(authoredAction.ownerNodeId, authoredAction.fieldDefinitionId);
  if (
    definitionNodeState(projection, authoredAction.fieldDefinitionId, FIELD_DEFINITION_INTRINSIC_NODE_TYPE) !== "active"
  ) {
    return `Field Definition type is absent: ${authoredAction.fieldDefinitionId}`;
  }
  for (const [nodeId, label] of [
    [authoredAction.ownerNodeId, "Field owner"],
    [authoredAction.fieldDefinitionId, "Field Definition"],
    [fieldNodeId, "Materialized Field"],
  ] as const) {
    if (!isActiveNode(projection.identity.workspaceNodeId, projection, nodeId)) {
      return `${label} Node does not exist: ${nodeId}`;
    }
  }
  const occurrence = projection.occurrences[fieldOccurrenceId];
  if (occurrence?.nodeId !== fieldNodeId) {
    return "Materialized Field Occurrence does not present the Field Node";
  }
  if (occurrence.parentNodeId !== authoredAction.ownerNodeId) {
    return "Materialized Field Occurrence is not stored under its owner Node";
  }
  const field = projection.materializedFields[authoredAction.ownerNodeId]?.find(
    (candidate) => candidate.fieldDefinitionId === authoredAction.fieldDefinitionId,
  );
  if (field?.fieldNodeId !== fieldNodeId || field.fieldOccurrenceId !== fieldOccurrenceId) {
    return "Materialized Field semantic identity is absent";
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
