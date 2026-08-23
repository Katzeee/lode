import { SearchDateComparisonOperator } from "@lode/protocol/dto/model";
import type {
  SearchClause,
  SearchExpressionDraft,
  SearchExpressionSpec,
  SearchFieldValue,
  SearchScopeTarget,
} from "./model.js";
import { required } from "./protocol-shape-codec.js";
import { factActionId } from "./fact-identities.js";

export function toSearchExpressionSpec(expression: SearchExpressionSpec): Record<string, unknown> {
  const value = expressionToProtocol(expression);
  return { expressionId: expression.expressionId, expressionNodeId: expression.expressionNodeId, expression: value };
}

export function fromSearchExpressionSpec(value: unknown): SearchExpressionSpec {
  const expression = required(value as Record<string, unknown> | null, "Search Expression");
  const expressionId = factActionId(expression.expressionId, "Search Expression identity");
  const expressionNodeId = expression.expressionNodeId as string;
  const selected = required(
    expression.expression as { $case: string; value: unknown } | null,
    "Search Expression clause",
  );
  const fields = selected.value as Record<string, unknown>;
  if (selected.$case === "all" || selected.$case === "any") {
    return {
      expressionId,
      expressionNodeId,
      kind: selected.$case === "all" ? "and" : "or",
      operands: (fields.values as readonly unknown[]).map(fromSearchExpressionSpec),
    };
  }
  if (selected.$case === "negated") {
    return { expressionId, expressionNodeId, kind: "not", operand: fromSearchExpressionSpec(fields.operand) };
  }
  if (selected.$case === "supertag") {
    return { expressionId, expressionNodeId, kind: "supertag", supertagId: fields.supertagId as string };
  }
  if (selected.$case === "text") {
    return { expressionId, expressionNodeId, kind: "text", text: fields.text as string };
  }
  if (selected.$case === "fieldDefined") {
    return {
      expressionId,
      expressionNodeId,
      kind: "field-defined",
      fieldDefinitionId: fields.fieldDefinitionId as string,
      defined: fields.defined as boolean,
    };
  }
  if (selected.$case === "fieldValue") {
    return {
      expressionId,
      expressionNodeId,
      kind: "field-value",
      fieldDefinitionId: fields.fieldDefinitionId as string,
      value: fieldValueFromProtocol(fields.value),
    };
  }
  if (selected.$case === "dateCompare") {
    return {
      expressionId,
      expressionNodeId,
      kind: "date-compare",
      fieldDefinitionId: fields.fieldDefinitionId as string,
      operator:
        fields.operator === "lt" || fields.operator === SearchDateComparisonOperator.SEARCH_DATE_COMPARISON_OPERATOR_LT
          ? "lt"
          : "gt",
      date: fields.date as string,
    };
  }
  if (selected.$case === "descendantOf" || selected.$case === "childOf") {
    return {
      expressionId,
      expressionNodeId,
      kind: selected.$case === "descendantOf" ? "descendant-of" : "child-of",
      target: scopeTargetFromProtocol(fields.target),
    };
  }
  return { expressionId, expressionNodeId, kind: "links-to", targetNodeId: fields.targetNodeId as string };
}

export function toSearchExpressionDraft(expression: SearchExpressionDraft): Record<string, unknown> {
  return { expression: draftToProtocol(expression) };
}

export function fromSearchExpressionDraft(value: unknown): SearchExpressionDraft {
  const message = required(value as Record<string, unknown> | null, "Search Expression draft");
  return draftFromSelected(
    required(message.expression as { $case: string; value: unknown } | null, "Search draft clause"),
  );
}

export function toSearchClause(clause: SearchClause): Record<string, unknown> {
  return { clause: clauseToProtocol(clause) };
}

export function fromSearchClause(value: unknown): SearchClause {
  const message = required(value as Record<string, unknown> | null, "Search clause");
  return clauseFromSelected(required(message.clause as { $case: string; value: unknown } | null, "Search clause"));
}

function expressionToProtocol(expression: SearchExpressionSpec): { $case: string; value: unknown } {
  if (expression.kind === "and" || expression.kind === "or") {
    return {
      $case: expression.kind === "and" ? "all" : "any",
      value: { values: expression.operands.map(toSearchExpressionSpec) },
    };
  }
  if (expression.kind === "not") {
    return { $case: "negated", value: { operand: toSearchExpressionSpec(expression.operand) } };
  }
  if (expression.kind === "supertag") {
    return { $case: "supertag", value: { supertagId: expression.supertagId } };
  }
  if (expression.kind === "text") {
    return { $case: "text", value: { text: expression.text } };
  }
  if (expression.kind === "field-defined") {
    return {
      $case: "fieldDefined",
      value: { fieldDefinitionId: expression.fieldDefinitionId, defined: expression.defined },
    };
  }
  if (expression.kind === "field-value") {
    return {
      $case: "fieldValue",
      value: { fieldDefinitionId: expression.fieldDefinitionId, value: fieldValueToProtocol(expression.value) },
    };
  }
  if (expression.kind === "date-compare") {
    return {
      $case: "dateCompare",
      value: {
        fieldDefinitionId: expression.fieldDefinitionId,
        operator:
          expression.operator === "lt"
            ? SearchDateComparisonOperator.SEARCH_DATE_COMPARISON_OPERATOR_LT
            : SearchDateComparisonOperator.SEARCH_DATE_COMPARISON_OPERATOR_GT,
        date: expression.date,
      },
    };
  }
  if (expression.kind === "descendant-of" || expression.kind === "child-of") {
    return {
      $case: expression.kind === "descendant-of" ? "descendantOf" : "childOf",
      value: { target: scopeTargetToProtocol(expression.target) },
    };
  }
  if (expression.kind === "links-to") {
    return { $case: "linksTo", value: { targetNodeId: expression.targetNodeId } };
  }
  throw new Error("Unsupported Search Expression clause");
}

function draftToProtocol(expression: SearchExpressionDraft): { $case: string; value: unknown } {
  if (expression.kind === "and" || expression.kind === "or") {
    return {
      $case: expression.kind === "and" ? "all" : "any",
      value: { values: expression.operands.map(toSearchExpressionDraft) },
    };
  }
  if (expression.kind === "not") {
    return { $case: "negated", value: { operand: toSearchExpressionDraft(expression.operand) } };
  }
  return clauseToProtocol(expression);
}

function draftFromSelected(selected: { $case: string; value: unknown }): SearchExpressionDraft {
  const fields = selected.value as Record<string, unknown>;
  if (selected.$case === "all" || selected.$case === "any") {
    return {
      kind: selected.$case === "all" ? "and" : "or",
      operands: (fields.values as readonly unknown[]).map(fromSearchExpressionDraft),
    };
  }
  if (selected.$case === "negated") {
    return { kind: "not", operand: fromSearchExpressionDraft(fields.operand) };
  }
  return clauseFromSelected(selected) as Exclude<SearchClause, { kind: "and" | "or" | "not" }>;
}

function clauseToProtocol(clause: SearchClause): { $case: string; value: unknown } {
  if (clause.kind === "and" || clause.kind === "or" || clause.kind === "not") {
    return {
      $case: clause.kind === "and" ? "all" : clause.kind === "or" ? "any" : "negated",
      value: {},
    };
  }
  return expressionToProtocol({
    expressionId: "g1/clause/0/0/actions/0",
    expressionNodeId: "",
    ...clause,
  } as SearchExpressionSpec);
}

function clauseFromSelected(selected: { $case: string; value: unknown }): SearchClause {
  if (selected.$case === "all" || selected.$case === "any" || selected.$case === "negated") {
    return { kind: selected.$case === "all" ? "and" : selected.$case === "any" ? "or" : "not" };
  }
  const decoded = fromSearchExpressionSpec({
    expressionId: "g1/clause/0/0/actions/0",
    expressionNodeId: "",
    expression: selected,
  });
  const { expressionId: _expressionId, expressionNodeId: _expressionNodeId, ...clause } = decoded;
  return clause;
}

function fieldValueToProtocol(value: SearchFieldValue): Record<string, unknown> {
  if (value.kind === "node") {
    return { value: { $case: "nodeId", value: value.nodeId } };
  }
  return { value: { $case: value.kind, value: value.value } };
}

function fieldValueFromProtocol(value: unknown): SearchFieldValue {
  const selected = required(
    (required(value as Record<string, unknown> | null, "Search Field value").value ?? null) as {
      $case: "nodeId" | "text" | "number" | "checkbox" | "date";
      value: unknown;
    } | null,
    "Search Field value",
  );
  return selected.$case === "nodeId"
    ? { kind: "node", nodeId: selected.value as string }
    : ({ kind: selected.$case, value: selected.value } as SearchFieldValue);
}

function scopeTargetToProtocol(target: SearchScopeTarget): Record<string, unknown> {
  return {
    target: target.kind === "node" ? { $case: "nodeId", value: target.nodeId } : { $case: target.kind, value: {} },
  };
}

function scopeTargetFromProtocol(value: unknown): SearchScopeTarget {
  const selected = required(
    (required(value as Record<string, unknown> | null, "Search scope target").target ?? null) as {
      $case: "nodeId" | "parent" | "grandparent";
      value: unknown;
    } | null,
    "Search scope target",
  );
  return selected.$case === "nodeId" ? { kind: "node", nodeId: selected.value as string } : { kind: selected.$case };
}
