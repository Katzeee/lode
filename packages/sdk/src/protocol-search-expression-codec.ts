import {
  SearchDateComparisonOperator,
  type SearchClause as ProtocolSearchClause,
  type SearchExpressionDraft as ProtocolSearchExpressionDraft,
  type SearchExpressionSpec as ProtocolSearchExpressionSpec,
} from "@lode/protocol/proto";
import type { SearchClause, SearchExpressionDraft, SearchExpressionSpec } from "./model.js";
import { required, selectedCase, unsupportedProtocolCase } from "./protocol-decoding.js";
import { factActionId } from "./fact-identities.js";
import {
  dateComparisonOperatorFromProtocol,
  fieldValueFromProtocol,
  fieldValueToProtocol,
  scopeTargetFromProtocol,
  scopeTargetToProtocol,
} from "./protocol-search-value-codec.js";

/**
 * The three search wire shapes (Spec, Draft, Clause) share every leaf clause;
 * they differ only in how the structural clauses (and/or/not) carry operands.
 * The leaf translation lives here once, and each shape owns its structure.
 */
type SearchLeafClause = Exclude<SearchClause, Readonly<{ kind: "and" | "or" | "not" }>>;

type SelectedClause =
  | Exclude<ProtocolSearchExpressionSpec["expression"], Readonly<{ case: undefined }>>
  | Exclude<ProtocolSearchExpressionDraft["expression"], Readonly<{ case: undefined }>>
  | Exclude<ProtocolSearchClause["clause"], Readonly<{ case: undefined }>>;

type SelectedLeafClause = Exclude<SelectedClause, Readonly<{ case: "all" | "any" | "negated" }>>;

export function toSearchExpressionSpec(expression: SearchExpressionSpec): Record<string, unknown> {
  const value = expressionToProtocol(expression);
  return { expressionId: expression.expressionId, expressionNodeId: expression.expressionNodeId, expression: value };
}

export function fromSearchExpressionSpec(value: unknown): SearchExpressionSpec {
  const expression = required(value as ProtocolSearchExpressionSpec | null, "Search Expression");
  const expressionId = factActionId(expression.expressionId, "Search Expression identity");
  const expressionNodeId = expression.expressionNodeId;
  const selected = selectedCase(expression.expression, "Search Expression clause");
  switch (selected.case) {
    case "all":
    case "any":
      return {
        expressionId,
        expressionNodeId,
        kind: selected.case === "all" ? "and" : "or",
        operands: selected.value.values.map(fromSearchExpressionSpec),
      };
    case "negated":
      return {
        expressionId,
        expressionNodeId,
        kind: "not",
        operand: fromSearchExpressionSpec(required(selected.value.operand, "Negated Search Expression operand")),
      };
    case "supertag":
    case "text":
    case "fieldDefined":
    case "fieldValue":
    case "dateCompare":
    case "descendantOf":
    case "childOf":
    case "linksTo":
      return { expressionId, expressionNodeId, ...leafFromSelected(selected, "Search Expression clause") };
    default:
      return unsupportedProtocolCase(selected, "Search Expression clause");
  }
}

export function toSearchExpressionDraft(expression: SearchExpressionDraft): Record<string, unknown> {
  return { expression: draftToProtocol(expression) };
}

export function fromSearchExpressionDraft(value: unknown): SearchExpressionDraft {
  const message = required(value as ProtocolSearchExpressionDraft | null, "Search Expression draft");
  const selected = selectedCase(message.expression, "Search draft clause");
  switch (selected.case) {
    case "all":
    case "any":
      return {
        kind: selected.case === "all" ? "and" : "or",
        operands: selected.value.values.map(fromSearchExpressionDraft),
      };
    case "negated":
      return {
        kind: "not",
        operand: fromSearchExpressionDraft(required(selected.value.operand, "Negated Search draft operand")),
      };
    case "supertag":
    case "text":
    case "fieldDefined":
    case "fieldValue":
    case "dateCompare":
    case "descendantOf":
    case "childOf":
    case "linksTo":
      return leafFromSelected(selected, "Search draft clause");
    default:
      return unsupportedProtocolCase(selected, "Search draft clause");
  }
}

export function toSearchClause(clause: SearchClause): Record<string, unknown> {
  return { clause: clauseToProtocol(clause) };
}

export function fromSearchClause(value: unknown): SearchClause {
  const message = required(value as ProtocolSearchClause | null, "Search clause");
  const selected = selectedCase(message.clause, "Search clause");
  switch (selected.case) {
    case "all":
      return { kind: "and" };
    case "any":
      return { kind: "or" };
    case "negated":
      return { kind: "not" };
    case "supertag":
    case "text":
    case "fieldDefined":
    case "fieldValue":
    case "dateCompare":
    case "descendantOf":
    case "childOf":
    case "linksTo":
      return leafFromSelected(selected, "Search clause");
    default:
      return unsupportedProtocolCase(selected, "Search clause");
  }
}

function expressionToProtocol(expression: SearchExpressionSpec): { case: string; value: unknown } {
  switch (expression.kind) {
    case "and":
    case "or":
      return {
        case: expression.kind === "and" ? "all" : "any",
        value: { values: expression.operands.map(toSearchExpressionSpec) },
      };
    case "not":
      return { case: "negated", value: { operand: toSearchExpressionSpec(expression.operand) } };
    case "supertag":
    case "text":
    case "field-defined":
    case "field-value":
    case "date-compare":
    case "descendant-of":
    case "child-of":
    case "links-to":
      return leafToProtocol(expression);
  }
}

function draftToProtocol(expression: SearchExpressionDraft): { case: string; value: unknown } {
  switch (expression.kind) {
    case "and":
    case "or":
      return {
        case: expression.kind === "and" ? "all" : "any",
        value: { values: expression.operands.map(toSearchExpressionDraft) },
      };
    case "not":
      return { case: "negated", value: { operand: toSearchExpressionDraft(expression.operand) } };
    case "supertag":
    case "text":
    case "field-defined":
    case "field-value":
    case "date-compare":
    case "descendant-of":
    case "child-of":
    case "links-to":
      return leafToProtocol(expression);
  }
}

function clauseToProtocol(clause: SearchClause): { case: string; value: unknown } {
  switch (clause.kind) {
    case "and":
    case "or":
    case "not":
      return {
        case: clause.kind === "and" ? "all" : clause.kind === "or" ? "any" : "negated",
        value: {},
      };
    case "supertag":
    case "text":
    case "field-defined":
    case "field-value":
    case "date-compare":
    case "descendant-of":
    case "child-of":
    case "links-to":
      return leafToProtocol(clause);
  }
}

function leafToProtocol(clause: SearchLeafClause): { case: string; value: unknown } {
  switch (clause.kind) {
    case "supertag":
      return { case: "supertag", value: { supertagId: clause.supertagId } };
    case "text":
      return { case: "text", value: { text: clause.text } };
    case "field-defined":
      return { case: "fieldDefined", value: { fieldDefinitionId: clause.fieldDefinitionId, defined: clause.defined } };
    case "field-value":
      return {
        case: "fieldValue",
        value: { fieldDefinitionId: clause.fieldDefinitionId, value: fieldValueToProtocol(clause.value) },
      };
    case "date-compare":
      return {
        case: "dateCompare",
        value: {
          fieldDefinitionId: clause.fieldDefinitionId,
          operator: clause.operator === "lt" ? SearchDateComparisonOperator.LT : SearchDateComparisonOperator.GT,
          date: clause.date,
        },
      };
    case "descendant-of":
    case "child-of":
      return {
        case: clause.kind === "descendant-of" ? "descendantOf" : "childOf",
        value: { target: scopeTargetToProtocol(clause.target) },
      };
    case "links-to":
      return { case: "linksTo", value: { targetNodeId: clause.targetNodeId } };
  }
}

function leafFromSelected(selected: SelectedLeafClause, label: string): SearchLeafClause {
  switch (selected.case) {
    case "supertag":
      return { kind: "supertag", supertagId: selected.value.supertagId };
    case "text":
      return { kind: "text", text: selected.value.text };
    case "fieldDefined":
      return {
        kind: "field-defined",
        fieldDefinitionId: selected.value.fieldDefinitionId,
        defined: selected.value.defined,
      };
    case "fieldValue":
      return {
        kind: "field-value",
        fieldDefinitionId: selected.value.fieldDefinitionId,
        value: fieldValueFromProtocol(required(selected.value.value, "Search Field value")),
      };
    case "dateCompare":
      return {
        kind: "date-compare",
        fieldDefinitionId: selected.value.fieldDefinitionId,
        operator: dateComparisonOperatorFromProtocol(selected.value.operator),
        date: selected.value.date,
      };
    case "descendantOf":
    case "childOf":
      return {
        kind: selected.case === "descendantOf" ? "descendant-of" : "child-of",
        target: scopeTargetFromProtocol(required(selected.value.target, "Search scope target")),
      };
    case "linksTo":
      return { kind: "links-to", targetNodeId: selected.value.targetNodeId };
    default:
      return unsupportedProtocolCase(selected, label);
  }
}
