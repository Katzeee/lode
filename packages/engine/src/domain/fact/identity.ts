const FIELD_DEFINITION_ENDPOINT_OCCURRENCE_PREFIX = "field-definition-endpoint-occ:v1:";
const TEMPLATE_INSTANCE_NODE_PREFIX = "template-instance:v1:";
const TEMPLATE_INSTANCE_OCCURRENCE_PREFIX = "template-instance-occ:v1:";
const WORKSPACE_TRASH_NODE_PREFIX = "workspace-trash:v1:";
const WORKSPACE_TRASH_OCCURRENCE_PREFIX = "workspace-trash-occ:v1:";
const WORKSPACE_SCHEMA_NODE_PREFIX = "workspace-schema:v1:";
const TEMPLATE_FIELD_INSTANCE_NODE_PREFIX = "template-field-instance:v1:";
const TEMPLATE_FIELD_INSTANCE_OCCURRENCE_PREFIX = "template-field-instance-occ:v1:";
const TEMPLATE_FIELD_INSTANCE_VALUE_NODE_PREFIX = "template-field-instance-value:v1:";
const TEMPLATE_FIELD_INSTANCE_VALUE_OCCURRENCE_PREFIX = "template-field-instance-value-occ:v1:";
export const SYSTEM_DEFINITION_CATALOG_NODE_ID = "system-definition-catalog:v1";
export const NODE_SUPERTAGS_DEFINITION_NODE_ID = "system-field-definition:v1:node-supertags";
export const SEARCH_EXPRESSION_DEFINITION_NODE_ID = "system-field-definition:v1:search-expression";
export const NODE_VIEWS_DEFINITION_NODE_ID = "system-field-definition:v1:node-views";
export const OPTIONAL_FIELDS_DEFINITION_NODE_ID = "system-field-definition:v1:optional-fields";
export const URL_DEFINITION_NODE_ID = "system-field-definition:v1:url";
export const CODE_BLOCK_LANGUAGE_DEFINITION_NODE_ID = "system-field-definition:v1:code-block-language";
export const VIEW_SORT_ORDER_DEFINITION_NODE_ID = "system-field-definition:v1:view-sort-order";
export const VIEW_SORT_FIELD_DEFINITION_NODE_ID = "system-field-definition:v1:view-sort-field";
export const VIEW_SORT_NODE_NAME_NODE_ID = "system-view-sort-value:v1:node-name";
export const VIEW_SORT_ASCENDING_NODE_ID = "system-view-sort-value:v1:ascending";
export const FIELD_DATATYPE_CATALOG_NODE_ID = "system-field-datatypes:v1";
export const FIELD_CARDINALITY_CATALOG_NODE_ID = "system-field-cardinalities:v1";
export const FIELD_OPTIONALITY_CATALOG_NODE_ID = "system-field-optionalities:v1";
export const FIELD_CONFIGURATION_DEFINITION_CATALOG_NODE_ID = "system-field-configuration-definitions:v1";
export const FIELD_CONFIGURATION_DEFINITION_NODE_IDS = {
  datatype: "system-field-configuration-definition:v1:datatype",
  cardinality: "system-field-configuration-definition:v1:cardinality",
  optionality: "system-field-configuration-definition:v1:optionality",
  initializationExpression: "system-field-configuration-definition:v1:initialization-expression",
} as const;
export const FIELD_DATATYPE_NODE_IDS = {
  plain: "system-field-datatype:v1:plain",
  options: "system-field-datatype:v1:options",
  optionsFromSupertag: "system-field-datatype:v1:options-from-supertag",
  number: "system-field-datatype:v1:number",
  checkbox: "system-field-datatype:v1:checkbox",
  date: "system-field-datatype:v1:date",
} as const;
export const CHECKBOX_VALUE_NODE_IDS = {
  yes: "system-checkbox-value:v1:yes",
  no: "system-checkbox-value:v1:no",
} as const;
export const FIELD_CARDINALITY_NODE_IDS = {
  single: "system-field-cardinality:v1:single",
  list: "system-field-cardinality:v1:list",
} as const;
export const FIELD_OPTIONALITY_NODE_IDS = {
  yes: "system-field-optionality:v1:yes",
  no: "system-field-optionality:v1:no",
} as const;

export function workspaceTrashNodeId(workspaceNodeId: string): string {
  return `${WORKSPACE_TRASH_NODE_PREFIX}${encodeURIComponent(workspaceNodeId)}`;
}

export function workspaceTrashOccurrenceId(workspaceNodeId: string): string {
  return `${WORKSPACE_TRASH_OCCURRENCE_PREFIX}${encodeURIComponent(workspaceNodeId)}`;
}

export function workspaceSchemaNodeId(workspaceNodeId: string): string {
  return `${WORKSPACE_SCHEMA_NODE_PREFIX}${encodeURIComponent(workspaceNodeId)}`;
}

export function fieldDefinitionEndpointOccurrenceId(fieldOccurrenceId: string): string {
  return `${FIELD_DEFINITION_ENDPOINT_OCCURRENCE_PREFIX}${encodeURIComponent(fieldOccurrenceId)}`;
}

export function templateInstanceNodeId(ownerNodeId: string, templateNodeId: string): string {
  return identity(TEMPLATE_INSTANCE_NODE_PREFIX, ownerNodeId, templateNodeId);
}

export function templateInstanceOccurrenceId(ownerNodeId: string, templateNodeId: string): string {
  return identity(TEMPLATE_INSTANCE_OCCURRENCE_PREFIX, ownerNodeId, templateNodeId);
}

export function templateFieldInstanceNodeId(ownerNodeId: string, templateFieldNodeId: string): string {
  return identity(TEMPLATE_FIELD_INSTANCE_NODE_PREFIX, ownerNodeId, templateFieldNodeId);
}

export function templateFieldInstanceOccurrenceId(ownerNodeId: string, templateFieldNodeId: string): string {
  return identity(TEMPLATE_FIELD_INSTANCE_OCCURRENCE_PREFIX, ownerNodeId, templateFieldNodeId);
}

export function templateFieldInstanceValueNodeId(ownerNodeId: string, templateFieldNodeId: string): string {
  return identity(TEMPLATE_FIELD_INSTANCE_VALUE_NODE_PREFIX, ownerNodeId, templateFieldNodeId);
}

export function templateFieldInstanceValueOccurrenceId(ownerNodeId: string, templateFieldNodeId: string): string {
  return identity(TEMPLATE_FIELD_INSTANCE_VALUE_OCCURRENCE_PREFIX, ownerNodeId, templateFieldNodeId);
}

function identity(prefix: string, ownerNodeId: string, templateNodeId: string): string {
  return `${prefix}${encodeURIComponent(ownerNodeId)}:${encodeURIComponent(templateNodeId)}`;
}
