import type { FactActionId } from "./fact-value-types.js";

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
