import { FIELD_DATATYPE_NODE_IDS } from "@lode/sdk";
import type { WorkspaceSnapshot } from "./workspace-model.js";

/** A source-text surface cannot submit the specialized intents of typed values. */
export function fieldUsesSourceText(graph: WorkspaceSnapshot, fieldDefinitionId: string): boolean {
  const types = new Set(
    (graph.fieldDefinitionConfigurations[fieldDefinitionId] ?? []).flatMap((item) =>
      item.kind === "datatype" ? [item.datatypeNodeId] : [],
    ),
  );
  return (
    types.size === 0 ||
    (types.size === 1 &&
      (types.has(FIELD_DATATYPE_NODE_IDS.plain) ||
        types.has(FIELD_DATATYPE_NODE_IDS.options) ||
        types.has(FIELD_DATATYPE_NODE_IDS.number)))
  );
}

export function nodeUsesSourceText(graph: WorkspaceSnapshot, nodeId: string): boolean {
  const owner = graph.nodeOwners[nodeId];
  const field = Object.values(graph.materializedFields)
    .flat()
    .find((field) => field.fieldNodeId === owner);
  return !field || fieldUsesSourceText(graph, field.fieldDefinitionId);
}
