import { defineAction, defineActionFamily } from "./action-definition.js";
import { VIEW_SORT_NODE_NAME_NODE_ID } from "./identity.js";
import {
  anchorIdentities,
  fieldDefinitionIdentities,
  identity,
  relationKey,
} from "./action-semantics/contribution-helpers.js";
import { SELF_FACT_ACTION } from "./action-semantics/types.js";
import { enumField, factActionIdField, nonemptyStringField, sequenceAnchorField } from "./action-field-decoders.js";

const viewTypeField = enumField(["outline", "table"] as const);
const sortDirectionField = enumField(["ascending", "descending"] as const);

export const viewActionDefinitions = defineActionFamily({
  addSharedDefault: defineAction(
    "shared-default-view-add",
    "proposable",
    {
      hostNodeId: nonemptyStringField,
      viewType: viewTypeField,
      anchor: sequenceAnchorField,
    },
    (action) => [
      identity({ kind: "node", nodeId: action.hostNodeId }, "relate", "require", "contribution-owner"),
      ...anchorIdentities(action.anchor),
      {
        kind: "causal-collection",
        collection: "shared-default-view",
        operation: "add",
        key: action.hostNodeId,
        entryId: SELF_FACT_ACTION,
        initialRegisters: { mode: action.viewType, position: action.anchor },
      },
    ],
  ),
  removeSharedDefault: defineAction(
    "shared-default-view-remove",
    "proposable",
    {
      hostNodeId: nonemptyStringField,
    },
    (action) => [
      identity({ kind: "node", nodeId: action.hostNodeId }, "relate", "require", "contribution-owner"),
      {
        kind: "causal-collection",
        collection: "shared-default-view",
        operation: "remove-observed",
        key: action.hostNodeId,
      },
    ],
  ),
  restoreSharedDefault: defineAction(
    "shared-default-view-restore",
    "proposable",
    {
      viewId: factActionIdField,
    },
    (action) => [
      identity({ kind: "fact-action", factActionId: action.viewId }, "relate", "require"),
      {
        kind: "causal-collection",
        collection: "shared-default-view",
        operation: "restore",
        entryId: action.viewId,
      },
    ],
  ),
  setMode: defineAction(
    "view-mode-set",
    "proposable",
    {
      viewId: factActionIdField,
      viewType: viewTypeField,
    },
    (action) => [
      identity({ kind: "fact-action", factActionId: action.viewId }, "relate", "require"),
      {
        kind: "causal-collection",
        collection: "shared-default-view",
        operation: "register",
        entryId: action.viewId,
        register: "mode",
        value: action.viewType,
      },
    ],
  ),
  addColumn: defineAction(
    "view-column-add",
    "proposable",
    {
      viewId: factActionIdField,
      fieldDefinitionId: nonemptyStringField,
      anchor: sequenceAnchorField,
    },
    (action) => [
      identity({ kind: "fact-action", factActionId: action.viewId }, "relate", "require"),
      ...viewFieldDefinitionIdentities(action.fieldDefinitionId),
      ...anchorIdentities(action.anchor),
      {
        kind: "causal-collection",
        collection: "view-column",
        operation: "add",
        key: relationKey(action.viewId, action.fieldDefinitionId),
        entryId: SELF_FACT_ACTION,
        initialRegisters: { position: action.anchor },
      },
    ],
  ),
  removeColumn: defineAction(
    "view-column-remove",
    "proposable",
    {
      viewId: factActionIdField,
      fieldDefinitionId: nonemptyStringField,
    },
    (action) => [
      identity({ kind: "fact-action", factActionId: action.viewId }, "relate", "require"),
      ...viewFieldDefinitionIdentities(action.fieldDefinitionId),
      {
        kind: "causal-collection",
        collection: "view-column",
        operation: "remove-observed",
        key: relationKey(action.viewId, action.fieldDefinitionId),
      },
    ],
  ),
  moveColumn: defineAction(
    "view-column-move",
    "proposable",
    {
      columnId: factActionIdField,
      anchor: sequenceAnchorField,
    },
    (action) => [
      identity({ kind: "fact-action", factActionId: action.columnId }, "relate", "require"),
      ...anchorIdentities(action.anchor),
      {
        kind: "causal-collection",
        collection: "view-column",
        operation: "register",
        entryId: action.columnId,
        register: "position",
        value: action.anchor,
      },
    ],
  ),
  addSort: defineAction(
    "view-sort-add",
    "proposable",
    {
      viewId: factActionIdField,
      fieldDefinitionId: nonemptyStringField,
      direction: sortDirectionField,
    },
    (action) => [
      identity({ kind: "fact-action", factActionId: action.viewId }, "relate", "require"),
      ...viewFieldDefinitionIdentities(action.fieldDefinitionId),
      {
        kind: "causal-collection",
        collection: "view-sort",
        operation: "add",
        key: action.viewId,
        entryId: SELF_FACT_ACTION,
        initialRegisters: {
          configuration: { fieldDefinitionId: action.fieldDefinitionId, direction: action.direction },
        },
      },
    ],
  ),
  configureSort: defineAction(
    "view-sort-configure",
    "proposable",
    {
      sortId: factActionIdField,
      fieldDefinitionId: nonemptyStringField,
      direction: sortDirectionField,
    },
    (action) => [
      identity({ kind: "fact-action", factActionId: action.sortId }, "relate", "require"),
      ...viewFieldDefinitionIdentities(action.fieldDefinitionId),
      {
        kind: "causal-collection",
        collection: "view-sort",
        operation: "register",
        entryId: action.sortId,
        register: "configuration",
        value: { fieldDefinitionId: action.fieldDefinitionId, direction: action.direction },
      },
    ],
  ),
  removeSort: defineAction("view-sort-remove", "proposable", { viewId: factActionIdField }, (action) => [
    identity({ kind: "fact-action", factActionId: action.viewId }, "relate", "require"),
    { kind: "causal-collection", collection: "view-sort", operation: "remove-observed", key: action.viewId },
  ]),
  restoreSort: defineAction("view-sort-restore", "proposable", { sortId: factActionIdField }, (action) => [
    identity({ kind: "fact-action", factActionId: action.sortId }, "relate", "require"),
    { kind: "causal-collection", collection: "view-sort", operation: "restore", entryId: action.sortId },
  ]),
  addGroup: defineAction(
    "view-group-add",
    "proposable",
    {
      viewId: factActionIdField,
      fieldDefinitionId: nonemptyStringField,
    },
    (action) => [
      identity({ kind: "fact-action", factActionId: action.viewId }, "relate", "require"),
      ...viewFieldDefinitionIdentities(action.fieldDefinitionId),
      {
        kind: "causal-collection",
        collection: "view-group",
        operation: "add",
        key: action.viewId,
        entryId: SELF_FACT_ACTION,
      },
    ],
  ),
  removeGroup: defineAction("view-group-remove", "proposable", { viewId: factActionIdField }, (action) => [
    identity({ kind: "fact-action", factActionId: action.viewId }, "relate", "require"),
    {
      kind: "causal-collection",
      collection: "view-group",
      operation: "remove-observed",
      key: action.viewId,
    },
  ]),
  addFilter: defineAction("view-filter-add", "proposable", { viewId: factActionIdField }, (action) => [
    identity({ kind: "fact-action", factActionId: action.viewId }, "relate", "require"),
    {
      kind: "causal-collection",
      collection: "view-filter",
      operation: "add",
      key: action.viewId,
      entryId: SELF_FACT_ACTION,
    },
  ]),
  removeFilter: defineAction("view-filter-remove", "proposable", { viewId: factActionIdField }, (action) => [
    identity({ kind: "fact-action", factActionId: action.viewId }, "relate", "require"),
    { kind: "causal-collection", collection: "view-filter", operation: "remove-observed", key: action.viewId },
  ]),
  restoreFilter: defineAction("view-filter-restore", "proposable", { filterId: factActionIdField }, (action) => [
    identity({ kind: "fact-action", factActionId: action.filterId }, "relate", "require"),
    { kind: "causal-collection", collection: "view-filter", operation: "restore", entryId: action.filterId },
  ]),
});

function viewFieldDefinitionIdentities(fieldDefinitionId: string) {
  if (fieldDefinitionId !== VIEW_SORT_NODE_NAME_NODE_ID) {
    return fieldDefinitionIdentities(fieldDefinitionId, "require");
  }
  return [
    identity({ kind: "field-definition", nodeId: fieldDefinitionId }, "relate"),
    identity({ kind: "node", nodeId: fieldDefinitionId }, "require"),
  ];
}
