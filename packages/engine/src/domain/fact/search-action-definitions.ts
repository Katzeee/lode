import { defineAction, defineActionFamily, field } from "./action-definition.js";
import {
  anchorIdentities,
  expressionHostIdentities,
  identity,
  searchClauseIdentities,
} from "./action-semantics/contribution-helpers.js";
import { SELF_FACT_ACTION } from "./action-semantics/types.js";
import {
  factActionIdField,
  nonemptyStringField,
  nullableFactActionIdField,
  sequenceAnchorField,
} from "./action-field-decoders.js";
import { parseSearchClause, type SearchClause } from "./search-expression-spec.js";

const searchClauseField = field<SearchClause>((value) => parseSearchClause(value));

export const searchActionDefinitions = defineActionFamily({
  addExpression: defineAction(
    "search-expression-add",
    "proposable",
    {
      expressionHostId: nonemptyStringField,
      parentExpressionId: nullableFactActionIdField,
      clause: searchClauseField,
      anchor: sequenceAnchorField,
    },
    (action) => [
      ...expressionHostIdentities(action.expressionHostId),
      ...(action.parentExpressionId === null
        ? []
        : [identity({ kind: "fact-action", factActionId: action.parentExpressionId }, "relate", "require")]),
      ...searchClauseIdentities(action.clause),
      ...anchorIdentities(action.anchor),
      {
        kind: "causal-collection",
        collection: "search-expression",
        operation: "add",
        key: SELF_FACT_ACTION,
        entryId: SELF_FACT_ACTION,
        initialRegisters: {
          clause: action.clause,
          position: { parentExpressionId: action.parentExpressionId, anchor: action.anchor },
        },
      },
    ],
  ),
  configureExpression: defineAction(
    "search-expression-configure",
    "proposable",
    {
      expressionId: factActionIdField,
      clause: searchClauseField,
    },
    (action) => [
      identity({ kind: "fact-action", factActionId: action.expressionId }, "relate", "require"),
      ...searchClauseIdentities(action.clause),
      {
        kind: "causal-collection",
        collection: "search-expression",
        operation: "register",
        entryId: action.expressionId,
        register: "clause",
        value: action.clause,
      },
    ],
  ),
  moveExpression: defineAction(
    "search-expression-move",
    "proposable",
    {
      expressionId: factActionIdField,
      parentExpressionId: nullableFactActionIdField,
      anchor: sequenceAnchorField,
    },
    (action) => [
      identity({ kind: "fact-action", factActionId: action.expressionId }, "relate", "require"),
      ...(action.parentExpressionId === null
        ? []
        : [identity({ kind: "fact-action", factActionId: action.parentExpressionId }, "relate", "require")]),
      {
        kind: "causal-collection",
        collection: "search-expression",
        operation: "register",
        entryId: action.expressionId,
        register: "position",
        value: { parentExpressionId: action.parentExpressionId, anchor: action.anchor },
      },
    ],
  ),
  removeExpression: defineAction(
    "search-expression-remove",
    "proposable",
    {
      expressionId: factActionIdField,
    },
    (action) => [
      identity({ kind: "fact-action", factActionId: action.expressionId }, "relate", "require"),
      {
        kind: "causal-collection",
        collection: "search-expression",
        operation: "remove-observed",
        key: action.expressionId,
      },
    ],
  ),
  restoreExpression: defineAction(
    "search-expression-restore",
    "proposable",
    {
      expressionId: factActionIdField,
    },
    (action) => [
      identity({ kind: "fact-action", factActionId: action.expressionId }, "relate", "require"),
      {
        kind: "causal-collection",
        collection: "search-expression",
        operation: "restore",
        entryId: action.expressionId,
      },
    ],
  ),
});
