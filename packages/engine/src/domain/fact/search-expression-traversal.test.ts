import { describe, expect, it } from "vitest";
import {
  findSearchExpression,
  findSearchExpressionParent,
  searchExpressionChildren,
  visitSearchExpression,
} from "./search-expression-traversal.js";
import type { SearchExpressionSpec } from "./search-expression-types.js";

const expression = {
  expressionId: "g1/workspace/1/1/actions/0",
  expressionNodeId: "root",
  kind: "and",
  operands: [
    {
      expressionId: "g1/workspace/1/1/actions/1",
      expressionNodeId: "negation",
      kind: "not",
      operand: {
        expressionId: "g1/workspace/1/1/actions/2",
        expressionNodeId: "text",
        kind: "text",
        text: "needle",
      },
    },
    {
      expressionId: "g1/workspace/1/1/actions/3",
      expressionNodeId: "tag",
      kind: "supertag",
      supertagId: "tag-id",
    },
  ],
} as const satisfies SearchExpressionSpec;

describe("Search Expression tree ownership", () => {
  it("finds nested expressions and their parent by Fact Action identity", () => {
    expect(findSearchExpression(expression, "g1/workspace/1/1/actions/2")).toMatchObject({
      expressionNodeId: "text",
      kind: "text",
    });
    expect(findSearchExpressionParent(expression, "g1/workspace/1/1/actions/2")).toMatchObject({
      expressionNodeId: "negation",
      kind: "not",
    });
    expect(findSearchExpressionParent(expression, expression.expressionId)).toBeUndefined();
    expect(findSearchExpression(expression, "g1/workspace/9/9/actions/9")).toBeUndefined();
  });

  it("exposes one exhaustive child traversal for logical and leaf expressions", () => {
    expect(searchExpressionChildren(expression).map((child) => child.expressionNodeId)).toEqual(["negation", "tag"]);
    const visited: string[] = [];
    visitSearchExpression(expression, (member) => visited.push(member.expressionNodeId));
    expect(visited).toEqual(["root", "negation", "text", "tag"]);
    const leaf = findSearchExpression(expression, "g1/workspace/1/1/actions/2");
    expect(leaf && searchExpressionChildren(leaf)).toEqual([]);
  });
});
