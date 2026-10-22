import { SYSTEM_FIELD_DATATYPE_NODE_IDS, SYSTEM_FIELD_OPTIONALITY_NODE_IDS } from "@lode/system-schema";

export {
  FIELD_CARDINALITIES,
  FIELD_CARDINALITY_NODE_IDS,
  FIELD_DATATYPES,
  workspaceSchemaNodeId,
  type FieldCardinality,
  type FieldDatatype,
} from "@lode/system-schema";

/** Stable identities and value vocabularies of the workspace's built-in Field schema. */

export const FIELD_DATATYPE_NODE_IDS = Object.freeze({
  plain: SYSTEM_FIELD_DATATYPE_NODE_IDS.plain,
  options: SYSTEM_FIELD_DATATYPE_NODE_IDS.options,
  "options-from-supertag": SYSTEM_FIELD_DATATYPE_NODE_IDS.optionsFromSupertag,
  number: SYSTEM_FIELD_DATATYPE_NODE_IDS.number,
  checkbox: SYSTEM_FIELD_DATATYPE_NODE_IDS.checkbox,
  date: SYSTEM_FIELD_DATATYPE_NODE_IDS.date,
});

export const FIELD_OPTIONALITY_NODE_IDS = Object.freeze({
  required: SYSTEM_FIELD_OPTIONALITY_NODE_IDS.yes,
  optional: SYSTEM_FIELD_OPTIONALITY_NODE_IDS.no,
});
