import { SearchDateComparisonOperator } from "@lode/protocol/dto/model";
import type { SearchExpressionSpec, SearchFieldValue, SearchScopeTarget } from "./model.js";
import { required } from "./protocol-shape-codec.js";

export function toSearchExpressionSpec(expression: SearchExpressionSpec): Record<string, unknown> {
  const value = expressionToProtocol(expression);
  return { expressionNodeId: expression.expressionNodeId, expression: value };
}

export function fromSearchExpressionSpec(value: unknown): SearchExpressionSpec {
  const expression = required(value as Record<string, unknown> | null, "Search Expression");
  const expressionNodeId = expression.expressionNodeId as string;
  const selected = required(
    expression.expression as { $case: string; value: unknown } | null,
    "Search Expression clause",
  );
  const fields = selected.value as Record<string, unknown>;
  if (selected.$case === "all" || selected.$case === "any") {
    return {
      expressionNodeId,
      kind: selected.$case === "all" ? "and" : "or",
      operands: (fields.values as readonly unknown[]).map(fromSearchExpressionSpec),
    };
  }
  if (selected.$case === "negated") {
    return { expressionNodeId, kind: "not", operand: fromSearchExpressionSpec(fields.operand) };
  }
  if (selected.$case === "supertag") {
    return { expressionNodeId, kind: "supertag", supertagId: fields.supertagId as string };
  }
  if (selected.$case === "text") {
    return { expressionNodeId, kind: "text", text: fields.text as string };
  }
  if (selected.$case === "fieldDefined") {
    return {
      expressionNodeId,
      kind: "field-defined",
      fieldDefinitionId: fields.fieldDefinitionId as string,
      defined: fields.defined as boolean,
    };
  }
  if (selected.$case === "fieldValue") {
    return {
      expressionNodeId,
      kind: "field-value",
      fieldDefinitionId: fields.fieldDefinitionId as string,
      value: fieldValueFromProtocol(fields.value),
    };
  }
  if (selected.$case === "dateCompare") {
    return {
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
      expressionNodeId,
      kind: selected.$case === "descendantOf" ? "descendant-of" : "child-of",
      target: scopeTargetFromProtocol(fields.target),
    };
  }
  return { expressionNodeId, kind: "links-to", targetNodeId: fields.targetNodeId as string };
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
