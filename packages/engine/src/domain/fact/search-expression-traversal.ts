import type { FactActionId } from "./fact-value-types.js";
import type { SearchClause, SearchExpressionSpec } from "./search-expression-types.js";

export function searchClauseFromSpec(expression: SearchExpressionSpec): SearchClause {
  if (expression.kind === "and" || expression.kind === "or" || expression.kind === "not") {
    return { kind: expression.kind };
  }
  const { expressionId: _expressionId, expressionNodeId: _expressionNodeId, ...clause } = expression;
  return clause;
}

export function searchExpressionChildren(expression: SearchExpressionSpec): readonly SearchExpressionSpec[] {
  return expression.kind === "and" || expression.kind === "or"
    ? expression.operands
    : expression.kind === "not"
      ? [expression.operand]
      : [];
}

export function findSearchExpression(
  expression: SearchExpressionSpec,
  expressionId: FactActionId,
): SearchExpressionSpec | undefined {
  if (expression.expressionId === expressionId) {
    return expression;
  }
  for (const child of searchExpressionChildren(expression)) {
    const found = findSearchExpression(child, expressionId);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

export function findSearchExpressionParent(
  expression: SearchExpressionSpec,
  expressionId: FactActionId,
): SearchExpressionSpec | undefined {
  const children = searchExpressionChildren(expression);
  if (children.some((child) => child.expressionId === expressionId)) {
    return expression;
  }
  for (const child of children) {
    const found = findSearchExpressionParent(child, expressionId);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

export function visitSearchExpression(
  expression: SearchExpressionSpec,
  visitor: (expression: SearchExpressionSpec) => void,
): void {
  visitor(expression);
  for (const child of searchExpressionChildren(expression)) {
    visitSearchExpression(child, visitor);
  }
}
