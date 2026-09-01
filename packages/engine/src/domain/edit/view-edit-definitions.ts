import { defineEdit, defineEditFamily } from "./edit-definition.js";
import {
  enumField,
  factActionIdField,
  nonemptyStringField,
  nullableFactActionIdField,
  searchClauseField,
  searchExpressionDraftField,
  sequenceAnchorField,
} from "./edit-field-decoders.js";

const hostNodeId = nonemptyStringField("View host Node identity");
const viewId = factActionIdField("View identity");
const fieldDefinitionId = nonemptyStringField("View option Field Definition identity");
const filterId = factActionIdField("View Filter identity");
const expressionId = factActionIdField("Search Expression identity");
const viewType = enumField("View type", "ViewType", ["outline", "table"] as const);
const direction = enumField("View Sort direction", "ViewSortDirection", ["ascending", "descending"] as const);

export const viewEditDefinitions = defineEditFamily({
  createSharedDefault: defineEdit("shared-default-view-create", {
    hostNodeId,
    viewType,
    anchor: sequenceAnchorField,
  }),
  removeSharedDefault: defineEdit("shared-default-view-remove", { hostNodeId }),
  setMode: defineEdit("view-mode-set", { hostNodeId, viewId, viewType }),
  addColumn: defineEdit("view-column-add", { hostNodeId, viewId, fieldDefinitionId, anchor: sequenceAnchorField }),
  removeColumn: defineEdit("view-column-remove", { hostNodeId, viewId, fieldDefinitionId }),
  moveColumn: defineEdit("view-column-move", {
    hostNodeId,
    viewId,
    columnId: factActionIdField("View Column identity"),
    anchor: sequenceAnchorField,
  }),
  addSort: defineEdit("view-sort-add", { hostNodeId, viewId, fieldDefinitionId, direction }),
  configureSort: defineEdit("view-sort-configure", {
    hostNodeId,
    viewId,
    sortId: factActionIdField("View Sort identity"),
    fieldDefinitionId,
    direction,
  }),
  removeSort: defineEdit("view-sort-remove", { hostNodeId, viewId }),
  sortByNodeName: defineEdit("view-sort-by-node-name", { hostNodeId, viewId, direction }),
  addGroup: defineEdit("view-group-add", { hostNodeId, viewId, fieldDefinitionId }),
  removeGroup: defineEdit("view-group-remove", { hostNodeId, viewId }),
  createFilter: defineEdit("view-filter-create", {
    hostNodeId,
    viewId,
    expression: searchExpressionDraftField,
    anchor: sequenceAnchorField,
  }),
  removeFilter: defineEdit("view-filter-remove", { hostNodeId, viewId }),
  addFilterExpression: defineEdit("view-filter-expression-add", {
    hostNodeId,
    viewId,
    filterId,
    parentExpressionId: factActionIdField("Search parent Expression identity"),
    expression: searchExpressionDraftField,
    anchor: sequenceAnchorField,
  }),
  configureFilterExpression: defineEdit("view-filter-expression-configure", {
    hostNodeId,
    viewId,
    filterId,
    expressionId,
    clause: searchClauseField,
  }),
  moveFilterExpression: defineEdit("view-filter-expression-move", {
    hostNodeId,
    viewId,
    filterId,
    expressionId,
    parentExpressionId: nullableFactActionIdField("Search parent Expression identity"),
    anchor: sequenceAnchorField,
  }),
  removeFilterExpression: defineEdit("view-filter-expression-remove", { hostNodeId, viewId, filterId, expressionId }),
});
