const INTRINSIC_NODE_TYPE_VALUES = [
  "supertag-definition",
  "field-definition",
  "field",
  "search",
  "command",
  "workspace",
  "calendar",
] as const;

const INTRINSIC_NODE_TYPE_VALUE_SET = new Set<unknown>(INTRINSIC_NODE_TYPE_VALUES);

export type IntrinsicNodeType = (typeof INTRINSIC_NODE_TYPE_VALUES)[number];

export type DefinitionIntrinsicNodeType = Extract<IntrinsicNodeType, "supertag-definition" | "field-definition">;

export const SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE = "supertag-definition" as const satisfies IntrinsicNodeType;
export const FIELD_DEFINITION_INTRINSIC_NODE_TYPE = "field-definition" as const satisfies IntrinsicNodeType;
export const FIELD_INTRINSIC_NODE_TYPE = "field" as const satisfies IntrinsicNodeType;
export const SEARCH_INTRINSIC_NODE_TYPE = "search" as const satisfies IntrinsicNodeType;
export const WORKSPACE_INTRINSIC_NODE_TYPE = "workspace" as const satisfies IntrinsicNodeType;

export function isIntrinsicNodeType(value: unknown): value is IntrinsicNodeType {
  return INTRINSIC_NODE_TYPE_VALUE_SET.has(value);
}
