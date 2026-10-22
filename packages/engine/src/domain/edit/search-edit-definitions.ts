import { defineEdit, defineEditFamily } from "./edit-definition.js";
import {
  factActionIdField,
  nonemptyStringField,
  nullableFactActionIdField,
  searchClauseField,
  searchExpressionDraftField,
  sequenceAnchorField,
} from "./edit-field-decoders.js";

const searchNodeId = nonemptyStringField("Search Node identity");
const expressionId = factActionIdField("Search Expression identity");

export const searchEditDefinitions = defineEditFamily({
  create: defineEdit("search-expression-create", {
    searchNodeId,
    expression: searchExpressionDraftField,
    anchor: sequenceAnchorField,
  }),
  add: defineEdit("search-expression-add", {
    searchNodeId,
    parentExpressionId: factActionIdField("Search parent Expression identity"),
    expression: searchExpressionDraftField,
    anchor: sequenceAnchorField,
  }),
  configure: defineEdit("search-expression-configure", { searchNodeId, expressionId, clause: searchClauseField }),
  move: defineEdit("search-expression-move", {
    searchNodeId,
    expressionId,
    parentExpressionId: nullableFactActionIdField("Search parent Expression identity"),
    anchor: sequenceAnchorField,
  }),
  remove: defineEdit("search-expression-remove", { searchNodeId, expressionId }),
});
