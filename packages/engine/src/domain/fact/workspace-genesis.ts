import {
  FIELD_CARDINALITY_CATALOG_NODE_ID,
  FIELD_CARDINALITY_NODE_IDS,
  FIELD_CONFIGURATION_DEFINITION_CATALOG_NODE_ID,
  FIELD_CONFIGURATION_DEFINITION_NODE_IDS,
  FIELD_DATATYPE_CATALOG_NODE_ID,
  FIELD_DATATYPE_NODE_IDS,
  CHECKBOX_VALUE_NODE_IDS,
  FIELD_OPTIONALITY_CATALOG_NODE_ID,
  FIELD_OPTIONALITY_NODE_IDS,
  NODE_SUPERTAGS_DEFINITION_NODE_ID,
  NODE_VIEWS_DEFINITION_NODE_ID,
  OPTIONAL_FIELDS_DEFINITION_NODE_ID,
  URL_DEFINITION_NODE_ID,
  CODE_BLOCK_LANGUAGE_DEFINITION_NODE_ID,
  VIEW_SORT_ORDER_DEFINITION_NODE_ID,
  VIEW_SORT_FIELD_DEFINITION_NODE_ID,
  VIEW_SORT_NODE_NAME_NODE_ID,
  VIEW_SORT_ASCENDING_NODE_ID,
  SEARCH_EXPRESSION_DEFINITION_NODE_ID,
  SYSTEM_DEFINITION_CATALOG_NODE_ID,
  workspaceTrashNodeId,
  workspaceTrashOccurrenceId,
  workspaceSchemaNodeId,
} from "./identity.js";
import { FIELD_DEFINITION_INTRINSIC_NODE_TYPE } from "./intrinsic-node-type-types.js";
import type { AuthoredAction } from "./types.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

export function workspaceGenesisActions(workspaceId: string): readonly [AuthoredAction, ...AuthoredAction[]] {
  return [
    { kind: "workspace-bootstrap", workspaceNodeId: workspaceId },
    {
      kind: "node-create",
      nodeId: workspaceSchemaNodeId(workspaceId),
      ownerNodeId: workspaceId,
      originalPlacement: null,
      seed: { text: [{ value: "Schema", attributes: {} }] },
    },
    {
      kind: "node-create",
      nodeId: workspaceTrashNodeId(workspaceId),
      ownerNodeId: workspaceId,
      originalPlacement: { placementId: workspaceTrashOccurrenceId(workspaceId), anchor: end },
      seed: { text: [{ value: "Trash", attributes: {} }] },
    },
    ...systemDefinitionCatalogActions(workspaceId),
  ];
}

function systemDefinitionCatalogActions(workspaceId: string): readonly AuthoredAction[] {
  const nodes = [
    [SYSTEM_DEFINITION_CATALOG_NODE_ID, "System Definitions", workspaceId],
    [NODE_SUPERTAGS_DEFINITION_NODE_ID, "Node supertags(s)", SYSTEM_DEFINITION_CATALOG_NODE_ID],
    [SEARCH_EXPRESSION_DEFINITION_NODE_ID, "Search expression", SYSTEM_DEFINITION_CATALOG_NODE_ID],
    [NODE_VIEWS_DEFINITION_NODE_ID, "Views for node", SYSTEM_DEFINITION_CATALOG_NODE_ID],
    [OPTIONAL_FIELDS_DEFINITION_NODE_ID, "Optional fields", SYSTEM_DEFINITION_CATALOG_NODE_ID],
    [URL_DEFINITION_NODE_ID, "URL", SYSTEM_DEFINITION_CATALOG_NODE_ID],
    [CODE_BLOCK_LANGUAGE_DEFINITION_NODE_ID, "Code block language", SYSTEM_DEFINITION_CATALOG_NODE_ID],
    [VIEW_SORT_ORDER_DEFINITION_NODE_ID, "Sort order definition", SYSTEM_DEFINITION_CATALOG_NODE_ID],
    [VIEW_SORT_FIELD_DEFINITION_NODE_ID, "Sort field definition", SYSTEM_DEFINITION_CATALOG_NODE_ID],
    [VIEW_SORT_NODE_NAME_NODE_ID, "Node name", SYSTEM_DEFINITION_CATALOG_NODE_ID],
    [VIEW_SORT_ASCENDING_NODE_ID, "ASC", SYSTEM_DEFINITION_CATALOG_NODE_ID],
    [FIELD_DATATYPE_CATALOG_NODE_ID, "Field Datatypes", SYSTEM_DEFINITION_CATALOG_NODE_ID],
    [FIELD_DATATYPE_NODE_IDS.plain, "Plain", FIELD_DATATYPE_CATALOG_NODE_ID],
    [FIELD_DATATYPE_NODE_IDS.options, "Options", FIELD_DATATYPE_CATALOG_NODE_ID],
    [FIELD_DATATYPE_NODE_IDS.optionsFromSupertag, "Options from Supertag", FIELD_DATATYPE_CATALOG_NODE_ID],
    [FIELD_DATATYPE_NODE_IDS.number, "Number", FIELD_DATATYPE_CATALOG_NODE_ID],
    [FIELD_DATATYPE_NODE_IDS.checkbox, "Checkbox", FIELD_DATATYPE_CATALOG_NODE_ID],
    [FIELD_DATATYPE_NODE_IDS.date, "Date", FIELD_DATATYPE_CATALOG_NODE_ID],
    [CHECKBOX_VALUE_NODE_IDS.yes, "Yes", SYSTEM_DEFINITION_CATALOG_NODE_ID],
    [CHECKBOX_VALUE_NODE_IDS.no, "No", SYSTEM_DEFINITION_CATALOG_NODE_ID],
    [FIELD_CARDINALITY_CATALOG_NODE_ID, "Field Cardinalities", SYSTEM_DEFINITION_CATALOG_NODE_ID],
    [FIELD_CARDINALITY_NODE_IDS.single, "Single value", FIELD_CARDINALITY_CATALOG_NODE_ID],
    [FIELD_CARDINALITY_NODE_IDS.list, "List of values", FIELD_CARDINALITY_CATALOG_NODE_ID],
    [FIELD_OPTIONALITY_CATALOG_NODE_ID, "Field Optionalities", SYSTEM_DEFINITION_CATALOG_NODE_ID],
    [FIELD_OPTIONALITY_NODE_IDS.yes, "Yes", FIELD_OPTIONALITY_CATALOG_NODE_ID],
    [FIELD_OPTIONALITY_NODE_IDS.no, "No", FIELD_OPTIONALITY_CATALOG_NODE_ID],
    [
      FIELD_CONFIGURATION_DEFINITION_CATALOG_NODE_ID,
      "Field Configuration Definitions",
      SYSTEM_DEFINITION_CATALOG_NODE_ID,
    ],
    [FIELD_CONFIGURATION_DEFINITION_NODE_IDS.datatype, "Datatype", FIELD_CONFIGURATION_DEFINITION_CATALOG_NODE_ID],
    [FIELD_CONFIGURATION_DEFINITION_NODE_IDS.optionality, "Optional", FIELD_CONFIGURATION_DEFINITION_CATALOG_NODE_ID],
    [
      FIELD_CONFIGURATION_DEFINITION_NODE_IDS.cardinality,
      "Cardinality",
      FIELD_CONFIGURATION_DEFINITION_CATALOG_NODE_ID,
    ],
    [
      FIELD_CONFIGURATION_DEFINITION_NODE_IDS.initializationExpression,
      "Initialize expression",
      FIELD_CONFIGURATION_DEFINITION_CATALOG_NODE_ID,
    ],
  ] as const;
  const fieldDefinitionIds = new Set<string>([
    ...Object.values(FIELD_CONFIGURATION_DEFINITION_NODE_IDS),
    NODE_SUPERTAGS_DEFINITION_NODE_ID,
    SEARCH_EXPRESSION_DEFINITION_NODE_ID,
    NODE_VIEWS_DEFINITION_NODE_ID,
    OPTIONAL_FIELDS_DEFINITION_NODE_ID,
    URL_DEFINITION_NODE_ID,
    CODE_BLOCK_LANGUAGE_DEFINITION_NODE_ID,
    VIEW_SORT_ORDER_DEFINITION_NODE_ID,
    VIEW_SORT_FIELD_DEFINITION_NODE_ID,
  ]);
  return nodes.map(([nodeId, title, ownerNodeId]): AuthoredAction => ({
    kind: "node-create",
    nodeId,
    ownerNodeId,
    originalPlacement: null,
    seed: { text: [{ value: title, attributes: {} }] },
    ...(fieldDefinitionIds.has(nodeId) ? { intrinsicNodeType: FIELD_DEFINITION_INTRINSIC_NODE_TYPE } : {}),
  }));
}
