import { array, booleanValue, enumValue, exact, nonempty, object, stringValue } from "../../decoding/index.js";
import { requireFactActionId } from "./identities.js";
import type { FactActionId } from "./types.js";

export type SearchFieldValue =
  | Readonly<{ kind: "node"; nodeId: string }>
  | Readonly<{ kind: "text"; value: string }>
  | Readonly<{ kind: "number"; value: number }>
  | Readonly<{ kind: "checkbox"; value: boolean }>
  | Readonly<{ kind: "date"; value: string }>;

export type SearchScopeTarget =
  Readonly<{ kind: "node"; nodeId: string }> | Readonly<{ kind: "parent" }> | Readonly<{ kind: "grandparent" }>;

export type SearchExpressionSpec = Readonly<{ expressionId: FactActionId; expressionNodeId: string }> &
  (
    | Readonly<{ kind: "and" | "or"; operands: readonly SearchExpressionSpec[] }>
    | Readonly<{ kind: "not"; operand: SearchExpressionSpec }>
    | Readonly<{ kind: "supertag"; supertagId: string }>
    | Readonly<{ kind: "text"; text: string }>
    | Readonly<{ kind: "field-defined"; fieldDefinitionId: string; defined: boolean }>
    | Readonly<{ kind: "field-value"; fieldDefinitionId: string; value: SearchFieldValue }>
    | Readonly<{
        kind: "date-compare";
        fieldDefinitionId: string;
        operator: "lt" | "gt";
        date: string;
      }>
    | Readonly<{ kind: "descendant-of" | "child-of"; target: SearchScopeTarget }>
    | Readonly<{ kind: "links-to"; targetNodeId: string }>
  );

export type SearchClause =
  | Readonly<{ kind: "and" | "or" | "not" }>
  | Readonly<{ kind: "supertag"; supertagId: string }>
  | Readonly<{ kind: "text"; text: string }>
  | Readonly<{ kind: "field-defined"; fieldDefinitionId: string; defined: boolean }>
  | Readonly<{ kind: "field-value"; fieldDefinitionId: string; value: SearchFieldValue }>
  | Readonly<{ kind: "date-compare"; fieldDefinitionId: string; operator: "lt" | "gt"; date: string }>
  | Readonly<{ kind: "descendant-of" | "child-of"; target: SearchScopeTarget }>
  | Readonly<{ kind: "links-to"; targetNodeId: string }>;

export type SearchExpressionDraft =
  | Readonly<{ kind: "and" | "or"; operands: readonly SearchExpressionDraft[] }>
  | Readonly<{ kind: "not"; operand: SearchExpressionDraft }>
  | Exclude<SearchClause, { kind: "and" | "or" | "not" }>;

export function parseSearchExpressionSpec(value: unknown): SearchExpressionSpec {
  const identities = new Set<string>();
  return parseExpression(value, identities, 0);
}

export function parseSearchClause(value: unknown): SearchClause {
  const clause = object(value, "Search clause");
  if (clause.kind === "and" || clause.kind === "or" || clause.kind === "not") {
    exact(clause, ["kind"], "Search logical clause");
    return { kind: clause.kind };
  }
  const parsed = parseExpression(
    { expressionId: "g1/clause/0/0/actions/0", expressionNodeId: "expression", ...clause },
    new Set(),
    0,
  );
  if (parsed.kind === "and" || parsed.kind === "or" || parsed.kind === "not") {
    throw new Error("Search logical clause cannot contain operands");
  }
  const { expressionId: _expressionId, expressionNodeId: _expressionNodeId, ...result } = parsed;
  return result;
}

export function parseSearchExpressionDraft(value: unknown, depth = 0): SearchExpressionDraft {
  if (depth > 64) {
    throw new Error("Search Expression nesting is too deep");
  }
  const draft = object(value, "Search Expression draft");
  if (draft.kind === "and" || draft.kind === "or") {
    exact(draft, ["kind", "operands"], "Search logical Expression draft");
    const operands = array(draft.operands, "Search logical operands", (operand) =>
      parseSearchExpressionDraft(operand, depth + 1),
    );
    if (operands.length === 0) {
      throw new Error("Search logical Expression has no operands");
    }
    return { kind: draft.kind, operands };
  }
  if (draft.kind === "not") {
    exact(draft, ["kind", "operand"], "Search NOT Expression draft");
    return { kind: "not", operand: parseSearchExpressionDraft(draft.operand, depth + 1) };
  }
  return parseSearchClause(draft) as Exclude<SearchClause, { kind: "and" | "or" | "not" }>;
}

export function searchClauseFromSpec(expression: SearchExpressionSpec): SearchClause {
  if (expression.kind === "and" || expression.kind === "or" || expression.kind === "not") {
    return { kind: expression.kind };
  }
  const { expressionId: _expressionId, expressionNodeId: _expressionNodeId, ...clause } = expression;
  return clause;
}

function parseExpression(value: unknown, identities: Set<string>, depth: number): SearchExpressionSpec {
  if (depth > 64) {
    throw new Error("Search Expression nesting is too deep");
  }
  const expression = object(value, "Search Expression");
  const expressionId = requireFactActionId(expression.expressionId, "Search Expression identity");
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
    exact(expression, ["expressionId", "expressionNodeId", "kind", "operands"], "Search logical Expression");
    const operands = array(expression.operands, "Search logical operands", (operand) =>
      parseExpression(operand, identities, depth + 1),
    );
    if (operands.length === 0) {
      throw new Error("Search logical Expression has no operands");
    }
    return { expressionId, expressionNodeId, kind, operands };
  }
  if (kind === "not") {
    exact(expression, ["expressionId", "expressionNodeId", "kind", "operand"], "Search NOT Expression");
    return {
      expressionId,
      expressionNodeId,
      kind,
      operand: parseExpression(expression.operand, identities, depth + 1),
    };
  }
  return parseLeafExpression(expression, { expressionId, expressionNodeId }, kind);
}

function parseLeafExpression(
  expression: Record<string, unknown>,
  identity: Readonly<{ expressionId: FactActionId; expressionNodeId: string }>,
  kind: Exclude<SearchExpressionSpec["kind"], "and" | "or" | "not">,
): SearchExpressionSpec {
  if (kind === "supertag") {
    exact(expression, ["expressionId", "expressionNodeId", "kind", "supertagId"], "Search Supertag Expression");
    return {
      ...identity,
      kind,
      supertagId: nonempty(expression.supertagId, "Search Supertag identity"),
    };
  }
  if (kind === "text") {
    exact(expression, ["expressionId", "expressionNodeId", "kind", "text"], "Search text Expression");
    return { ...identity, kind, text: nonempty(expression.text, "Search text") };
  }
  if (kind === "field-defined") {
    exact(
      expression,
      ["expressionId", "expressionNodeId", "kind", "fieldDefinitionId", "defined"],
      "Search Field Defined Expression",
    );
    return {
      ...identity,
      kind,
      fieldDefinitionId: nonempty(expression.fieldDefinitionId, "Search Field Definition identity"),
      defined: booleanValue(expression.defined, "Search Field Defined value"),
    };
  }
  if (kind === "field-value") {
    exact(
      expression,
      ["expressionId", "expressionNodeId", "kind", "fieldDefinitionId", "value"],
      "Search Field value Expression",
    );
    return {
      ...identity,
      kind,
      fieldDefinitionId: nonempty(expression.fieldDefinitionId, "Search Field Definition identity"),
      value: parseFieldValue(expression.value),
    };
  }
  if (kind === "date-compare") {
    exact(
      expression,
      ["expressionId", "expressionNodeId", "kind", "fieldDefinitionId", "operator", "date"],
      "Search Date comparison Expression",
    );
    const date = stringValue(expression.date, "Search comparison Date");
    assertDate(date);
    return {
      ...identity,
      kind,
      fieldDefinitionId: nonempty(expression.fieldDefinitionId, "Search Field Definition identity"),
      operator: enumValue(expression.operator, ["lt", "gt"] as const, "Search Date comparison operator"),
      date,
    };
  }
  if (kind === "descendant-of" || kind === "child-of") {
    exact(expression, ["expressionId", "expressionNodeId", "kind", "target"], "Search scope Expression");
    return { ...identity, kind, target: parseScopeTarget(expression.target) };
  }
  exact(expression, ["expressionId", "expressionNodeId", "kind", "targetNodeId"], "Search links-to Expression");
  return {
    ...identity,
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
