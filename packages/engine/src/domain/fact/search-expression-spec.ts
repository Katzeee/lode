import { array, booleanValue, enumValue, exact, nonempty, object, stringValue } from "../../decoding/index.js";

export type SearchFieldValue =
  | Readonly<{ kind: "node"; nodeId: string }>
  | Readonly<{ kind: "text"; value: string }>
  | Readonly<{ kind: "number"; value: number }>
  | Readonly<{ kind: "checkbox"; value: boolean }>
  | Readonly<{ kind: "date"; value: string }>;

export type SearchScopeTarget =
  Readonly<{ kind: "node"; nodeId: string }> | Readonly<{ kind: "parent" }> | Readonly<{ kind: "grandparent" }>;

export type SearchExpressionSpec =
  | Readonly<{ expressionNodeId: string; kind: "and" | "or"; operands: readonly SearchExpressionSpec[] }>
  | Readonly<{ expressionNodeId: string; kind: "not"; operand: SearchExpressionSpec }>
  | Readonly<{ expressionNodeId: string; kind: "supertag"; supertagId: string }>
  | Readonly<{ expressionNodeId: string; kind: "text"; text: string }>
  | Readonly<{
      expressionNodeId: string;
      kind: "field-defined";
      fieldDefinitionId: string;
      defined: boolean;
    }>
  | Readonly<{
      expressionNodeId: string;
      kind: "field-value";
      fieldDefinitionId: string;
      value: SearchFieldValue;
    }>
  | Readonly<{
      expressionNodeId: string;
      kind: "date-compare";
      fieldDefinitionId: string;
      operator: "lt" | "gt";
      date: string;
    }>
  | Readonly<{
      expressionNodeId: string;
      kind: "descendant-of" | "child-of";
      target: SearchScopeTarget;
    }>
  | Readonly<{ expressionNodeId: string; kind: "links-to"; targetNodeId: string }>;

export function parseSearchExpressionSpec(value: unknown): SearchExpressionSpec {
  const identities = new Set<string>();
  return parseExpression(value, identities, 0);
}

export function searchExpressionNodeIds(expression: SearchExpressionSpec): readonly string[] {
  const result: string[] = [];
  visitSearchExpression(expression, (candidate) => result.push(candidate.expressionNodeId));
  return result;
}

export function visitSearchExpression(
  expression: SearchExpressionSpec,
  visit: (expression: SearchExpressionSpec) => void,
): void {
  visit(expression);
  if (expression.kind === "and" || expression.kind === "or") {
    expression.operands.forEach((operand) => visitSearchExpression(operand, visit));
  } else if (expression.kind === "not") {
    visitSearchExpression(expression.operand, visit);
  }
}

function parseExpression(value: unknown, identities: Set<string>, depth: number): SearchExpressionSpec {
  if (depth > 64) {
    throw new Error("Search Expression nesting is too deep");
  }
  const expression = object(value, "Search Expression");
  const expressionNodeId = nonempty(expression.expressionNodeId, "Search Expression Node identity");
  if (identities.has(expressionNodeId)) {
    throw new Error(`Search Expression repeats a Node identity: ${expressionNodeId}`);
  }
  identities.add(expressionNodeId);
  const kind = enumValue(
    expression.kind,
    [
      "and",
      "or",
      "not",
      "supertag",
      "text",
      "field-defined",
      "field-value",
      "date-compare",
      "descendant-of",
      "child-of",
      "links-to",
    ] as const,
    "Search Expression kind",
  );
  if (kind === "and" || kind === "or") {
    exact(expression, ["expressionNodeId", "kind", "operands"], "Search logical Expression");
    const operands = array(expression.operands, "Search logical operands", (operand) =>
      parseExpression(operand, identities, depth + 1),
    );
    if (operands.length === 0) {
      throw new Error("Search logical Expression has no operands");
    }
    return { expressionNodeId, kind, operands };
  }
  if (kind === "not") {
    exact(expression, ["expressionNodeId", "kind", "operand"], "Search NOT Expression");
    return { expressionNodeId, kind, operand: parseExpression(expression.operand, identities, depth + 1) };
  }
  if (kind === "supertag") {
    exact(expression, ["expressionNodeId", "kind", "supertagId"], "Search Supertag Expression");
    return { expressionNodeId, kind, supertagId: nonempty(expression.supertagId, "Search Supertag identity") };
  }
  if (kind === "text") {
    exact(expression, ["expressionNodeId", "kind", "text"], "Search text Expression");
    return { expressionNodeId, kind, text: nonempty(expression.text, "Search text") };
  }
  if (kind === "field-defined") {
    exact(expression, ["expressionNodeId", "kind", "fieldDefinitionId", "defined"], "Search Field Defined Expression");
    return {
      expressionNodeId,
      kind,
      fieldDefinitionId: nonempty(expression.fieldDefinitionId, "Search Field Definition identity"),
      defined: booleanValue(expression.defined, "Search Field Defined value"),
    };
  }
  if (kind === "field-value") {
    exact(expression, ["expressionNodeId", "kind", "fieldDefinitionId", "value"], "Search Field value Expression");
    return {
      expressionNodeId,
      kind,
      fieldDefinitionId: nonempty(expression.fieldDefinitionId, "Search Field Definition identity"),
      value: parseFieldValue(expression.value),
    };
  }
  if (kind === "date-compare") {
    exact(
      expression,
      ["expressionNodeId", "kind", "fieldDefinitionId", "operator", "date"],
      "Search Date comparison Expression",
    );
    const date = stringValue(expression.date, "Search comparison Date");
    assertDate(date);
    return {
      expressionNodeId,
      kind,
      fieldDefinitionId: nonempty(expression.fieldDefinitionId, "Search Field Definition identity"),
      operator: enumValue(expression.operator, ["lt", "gt"] as const, "Search Date comparison operator"),
      date,
    };
  }
  if (kind === "descendant-of" || kind === "child-of") {
    exact(expression, ["expressionNodeId", "kind", "target"], "Search scope Expression");
    return { expressionNodeId, kind, target: parseScopeTarget(expression.target) };
  }
  exact(expression, ["expressionNodeId", "kind", "targetNodeId"], "Search links-to Expression");
  return {
    expressionNodeId,
    kind,
    targetNodeId: nonempty(expression.targetNodeId, "Search links-to target Node identity"),
  };
}

function parseFieldValue(value: unknown): SearchFieldValue {
  const candidate = object(value, "Search Field value");
  const kind = enumValue(
    candidate.kind,
    ["node", "text", "number", "checkbox", "date"] as const,
    "Search Field value kind",
  );
  if (kind === "node") {
    exact(candidate, ["kind", "nodeId"], "Search Node Field value");
    return { kind, nodeId: nonempty(candidate.nodeId, "Search Field value Node identity") };
  }
  if (kind === "checkbox") {
    exact(candidate, ["kind", "value"], "Search Checkbox Field value");
    return { kind, value: booleanValue(candidate.value, "Search Checkbox Field value") };
  }
  if (kind === "number") {
    exact(candidate, ["kind", "value"], "Search Number Field value");
    if (typeof candidate.value !== "number" || !Number.isFinite(candidate.value)) {
      throw new Error("Search Number Field value is invalid");
    }
    return { kind, value: candidate.value };
  }
  exact(candidate, ["kind", "value"], `Search ${kind} Field value`);
  const parsed = stringValue(candidate.value, `Search ${kind} Field value`);
  if (kind === "date") {
    assertDate(parsed);
  }
  return { kind, value: parsed };
}

function parseScopeTarget(value: unknown): SearchScopeTarget {
  const target = object(value, "Search scope target");
  const kind = enumValue(target.kind, ["node", "parent", "grandparent"] as const, "Search scope target kind");
  if (kind === "node") {
    exact(target, ["kind", "nodeId"], "Search Node scope target");
    return { kind, nodeId: nonempty(target.nodeId, "Search scope target Node identity") };
  }
  exact(target, ["kind"], "Search relative scope target");
  return { kind };
}

function assertDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error("Search Date value is invalid");
  }
}
