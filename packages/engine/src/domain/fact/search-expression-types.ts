import type { FactActionId, SequenceAnchor } from "./types.js";
import type { SearchClause } from "./search-expression-spec.js";

export type SearchExpressionAction =
  | Readonly<{
      kind: "search-expression-add";
      expressionHostId: string;
      parentExpressionId: FactActionId | null;
      clause: SearchClause;
      anchor: SequenceAnchor;
    }>
  | Readonly<{ kind: "search-expression-configure"; expressionId: FactActionId; clause: SearchClause }>
  | Readonly<{
      kind: "search-expression-move";
      expressionId: FactActionId;
      parentExpressionId: FactActionId | null;
      anchor: SequenceAnchor;
    }>
  | Readonly<{ kind: "search-expression-remove"; expressionId: FactActionId }>
  | Readonly<{ kind: "search-expression-restore"; expressionId: FactActionId }>;
