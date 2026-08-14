import type { SchemaMutation } from "../../fact/index.js";
import type { Projection } from "../projection-types.js";

export function canApplySchemaDirectTail(
  projection: Projection,
  mutation: SchemaMutation,
): boolean {
  switch (mutation.kind) {
    case "schema-apply":
    case "schema-remove":
      return hasNodes(projection, mutation.nodeId, mutation.schemaId);
    case "schema-template-node-add":
    case "schema-template-node-remove":
      return hasNodes(projection, mutation.schemaId, mutation.templateNodeId);
    case "schema-field-add":
    case "schema-field-remove":
    case "schema-field-configure":
      return hasNodes(projection, mutation.schemaId, mutation.fieldDefinitionId);
    case "schema-extension-add":
    case "schema-extension-remove":
      return hasNodes(projection, mutation.schemaId, mutation.baseSchemaId);
  }
}

function hasNodes(projection: Projection, ...nodeIds: readonly string[]): boolean {
  return nodeIds.every((nodeId) => projection.nodes[nodeId] !== undefined);
}
