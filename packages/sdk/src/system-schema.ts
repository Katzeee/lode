/** Stable identities and value vocabularies of the workspace's built-in Field schema. */
export const FIELD_DATATYPES = ["plain", "options", "options-from-supertag", "number", "checkbox", "date"] as const;
export type FieldDatatype = (typeof FIELD_DATATYPES)[number];

export const FIELD_DATATYPE_NODE_IDS = Object.freeze({
  plain: "system-field-datatype:v1:plain",
  options: "system-field-datatype:v1:options",
  "options-from-supertag": "system-field-datatype:v1:options-from-supertag",
  number: "system-field-datatype:v1:number",
  checkbox: "system-field-datatype:v1:checkbox",
  date: "system-field-datatype:v1:date",
} satisfies Readonly<Record<FieldDatatype, string>>);

export const FIELD_CARDINALITIES = ["single", "list"] as const;
export type FieldCardinality = (typeof FIELD_CARDINALITIES)[number];

export const FIELD_CARDINALITY_NODE_IDS = Object.freeze({
  single: "system-field-cardinality:v1:single",
  list: "system-field-cardinality:v1:list",
} satisfies Readonly<Record<FieldCardinality, string>>);

export const FIELD_OPTIONALITY_NODE_IDS = Object.freeze({
  required: "system-field-optionality:v1:yes",
  optional: "system-field-optionality:v1:no",
});

export function workspaceSchemaNodeId(workspaceId: string): string {
  return `workspace-schema:v1:${encodeURIComponent(workspaceId)}`;
}
