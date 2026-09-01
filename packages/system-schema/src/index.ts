export const FIELD_DATATYPES = ["plain", "options", "options-from-supertag", "number", "checkbox", "date"] as const;
export type FieldDatatype = (typeof FIELD_DATATYPES)[number];

export const SYSTEM_FIELD_DATATYPE_NODE_IDS = Object.freeze({
  plain: "system-field-datatype:v1:plain",
  options: "system-field-datatype:v1:options",
  optionsFromSupertag: "system-field-datatype:v1:options-from-supertag",
  number: "system-field-datatype:v1:number",
  checkbox: "system-field-datatype:v1:checkbox",
  date: "system-field-datatype:v1:date",
});

export const FIELD_CARDINALITIES = ["single", "list"] as const;
export type FieldCardinality = (typeof FIELD_CARDINALITIES)[number];

export const FIELD_CARDINALITY_NODE_IDS = Object.freeze({
  single: "system-field-cardinality:v1:single",
  list: "system-field-cardinality:v1:list",
});

export const SYSTEM_FIELD_OPTIONALITY_NODE_IDS = Object.freeze({
  yes: "system-field-optionality:v1:yes",
  no: "system-field-optionality:v1:no",
});

const WORKSPACE_SCHEMA_NODE_PREFIX = "workspace-schema:v1:";

export function workspaceSchemaNodeId(workspaceId: string): string {
  return `${WORKSPACE_SCHEMA_NODE_PREFIX}${encodeURIComponent(workspaceId)}`;
}
