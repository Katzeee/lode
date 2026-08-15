const NODE_TYPE_VALUES = [
  "schema",
  "field-definition",
  "field",
  "search",
  "command",
  "workspace",
  "calendar",
  "view",
] as const;

const NODE_TYPE_VALUE_SET = new Set<unknown>(NODE_TYPE_VALUES);

export type NodeType = (typeof NODE_TYPE_VALUES)[number];

export type DefinitionNodeType = Extract<NodeType, "schema" | "field-definition">;

export const SCHEMA_NODE_TYPE = "schema" as const satisfies NodeType;
export const FIELD_DEFINITION_NODE_TYPE = "field-definition" as const satisfies NodeType;
export const FIELD_NODE_TYPE = "field" as const satisfies NodeType;
export const SEARCH_NODE_TYPE = "search" as const satisfies NodeType;
export const COMMAND_NODE_TYPE = "command" as const satisfies NodeType;
export const WORKSPACE_NODE_TYPE = "workspace" as const satisfies NodeType;
export const VIEW_NODE_TYPE = "view" as const satisfies NodeType;

export function isNodeType(value: unknown): value is NodeType {
  return NODE_TYPE_VALUE_SET.has(value);
}
