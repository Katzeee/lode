import type { SearchExpressionSpec } from "./search-expression-spec.js";

type SearchExpressionMutationFields = Readonly<{
  searchNodeId: string;
  expressionNodeId: string;
  expressionOccurrenceId: string;
  definitionOccurrenceId: string;
  expression: SearchExpressionSpec;
}>;

export type SearchExpressionMutation =
  | (SearchExpressionMutationFields &
      Readonly<{ kind: "search-expression-attach"; previousExpression?: SearchExpressionSpec }>)
  | (SearchExpressionMutationFields & Readonly<{ kind: "search-expression-detach" }>);
