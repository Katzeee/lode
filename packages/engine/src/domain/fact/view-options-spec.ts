import { assertOneOf, exact, nonempty, object } from "../../decoding/index.js";
import { requireFactActionId } from "./identities.js";
import { parseSearchExpressionSpec, type SearchExpressionSpec } from "./search-expression-spec.js";
import type { FactActionId } from "./types.js";

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

export function parseViewOptionsSpec(value: unknown): ViewOptionsSpec {
  const record = object(value, "View options");
  exact(record, ["columns", "filter", "sort", "group"], "View options");
  if (!Array.isArray(record.columns)) {
    throw new Error("View columns must be an array");
  }
  return {
    columns: record.columns.map(parseColumn),
    filter: record.filter === null ? null : parseFilter(record.filter),
    sort: record.sort === null ? null : parseSort(record.sort),
    group: record.group === null ? null : parseGroup(record.group),
  };
}

function parseColumn(value: unknown): ViewColumnSpec {
  const record = object(value, "View column");
  exact(record, ["columnId", "columnNodeId", "fieldDefinitionId"], "View column");
  return {
    columnId: requireFactActionId(record.columnId, "View column identity"),
    columnNodeId: nonempty(record.columnNodeId, "View column Node identity"),
    fieldDefinitionId: nonempty(record.fieldDefinitionId, "View column Field Definition identity"),
  };
}

function parseFilter(value: unknown): ViewFilterSpec {
  const record = object(value, "View filter");
  exact(record, ["filterId", "filterNodeId", "expression"], "View filter");
  return {
    filterId: requireFactActionId(record.filterId, "View filter identity"),
    filterNodeId: nonempty(record.filterNodeId, "View filter Node identity"),
    expression: parseSearchExpressionSpec(record.expression),
  };
}

function parseSort(value: unknown): ViewSortSpec {
  const record = object(value, "View sort");
  exact(record, ["sortId", "sortNodeId", "fieldDefinitionId", "direction"], "View sort");
  assertOneOf(record.direction, ["ascending", "descending"] as const, "View sort direction");
  const direction = record.direction as "ascending" | "descending";
  return {
    sortId: requireFactActionId(record.sortId, "View sort identity"),
    sortNodeId: nonempty(record.sortNodeId, "View sort Node identity"),
    fieldDefinitionId: nonempty(record.fieldDefinitionId, "View sort Field Definition identity"),
    direction,
  };
}

function parseGroup(value: unknown): ViewGroupSpec {
  const record = object(value, "View group");
  exact(record, ["groupId", "groupNodeId", "fieldDefinitionId"], "View group");
  return {
    groupId: requireFactActionId(record.groupId, "View group identity"),
    groupNodeId: nonempty(record.groupNodeId, "View group Node identity"),
    fieldDefinitionId: nonempty(record.fieldDefinitionId, "View group Field Definition identity"),
  };
}
