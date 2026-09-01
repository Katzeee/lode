import type { SearchExpressionSpec } from "./search-expression-types.js";
import type { FactActionId } from "./fact-value-types.js";

export type ViewColumnSpec = Readonly<{
  columnId: FactActionId;
  columnNodeId: string;
  fieldDefinitionId: string;
}>;

type ViewFilterSpec = Readonly<{
  filterId: FactActionId;
  filterNodeId: string;
  expression: SearchExpressionSpec;
}>;

export type ViewSortSpec = Readonly<{
  sortId: FactActionId;
  sortNodeId: string;
  fieldDefinitionId: string;
  direction: "ascending" | "descending";
}>;

export type ViewGroupSpec = Readonly<{
  groupId: FactActionId;
  groupNodeId: string;
  fieldDefinitionId: string;
}>;

export type ViewOptionsSpec = Readonly<{
  columns: readonly ViewColumnSpec[];
  filter: ViewFilterSpec | null;
  sort: ViewSortSpec | null;
  group: ViewGroupSpec | null;
}>;
