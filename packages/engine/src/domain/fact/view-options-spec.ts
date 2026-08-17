import {
  parseSearchExpressionSpec,
  searchExpressionNodeIds,
  type SearchExpressionSpec,
} from "./search-expression-spec.js";

export type ViewColumnSpec = Readonly<{
  columnNodeId: string;
  fieldDefinitionId: string;
}>;

export type ViewFilterSpec = Readonly<{
  filterNodeId: string;
  expression: SearchExpressionSpec;
}>;

export type ViewSortSpec = Readonly<{
  sortNodeId: string;
  fieldDefinitionId: string;
  direction: "ascending" | "descending";
}>;

export type ViewGroupSpec = Readonly<{
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
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("View options must be an object");
  }
  const record = value as Record<string, unknown>;
  assertExactKeys(record, ["columns", "filter", "sort", "group"]);
  if (!Array.isArray(record.columns)) {
    throw new Error("View columns must be an array");
  }
  const columns = record.columns.map((column) => parseColumn(column));
  const filter = record.filter === null ? null : parseFilter(record.filter);
  const sort = record.sort === null ? null : parseSort(record.sort);
  const group = record.group === null ? null : parseGroup(record.group);
  const identities = [
    ...columns.map((column) => column.columnNodeId),
    ...(filter === null ? [] : [filter.filterNodeId, ...searchExpressionNodeIds(filter.expression)]),
    ...(sort === null ? [] : [sort.sortNodeId]),
    ...(group === null ? [] : [group.groupNodeId]),
  ];
  if (new Set(identities).size !== identities.length) {
    throw new Error("View option identities must be unique");
  }
  return { columns, filter, sort, group };
}

export function viewOptionNodeIds(options: ViewOptionsSpec): readonly string[] {
  return [
    ...options.columns.map((column) => column.columnNodeId),
    ...(options.filter === null
      ? []
      : [options.filter.filterNodeId, ...searchExpressionNodeIds(options.filter.expression)]),
    ...(options.sort === null ? [] : [options.sort.sortNodeId]),
    ...(options.group === null ? [] : [options.group.groupNodeId]),
  ];
}

function parseColumn(value: unknown): ViewColumnSpec {
  const record = object(value, "View column");
  assertExactKeys(record, ["columnNodeId", "fieldDefinitionId"]);
  return {
    columnNodeId: identity(record.columnNodeId, "View column"),
    fieldDefinitionId: identity(record.fieldDefinitionId, "View column Field Definition"),
  };
}

function parseFilter(value: unknown): ViewFilterSpec {
  const record = object(value, "View filter");
  assertExactKeys(record, ["filterNodeId", "expression"]);
  return {
    filterNodeId: identity(record.filterNodeId, "View filter"),
    expression: parseSearchExpressionSpec(record.expression),
  };
}

function parseSort(value: unknown): ViewSortSpec {
  const record = object(value, "View sort");
  assertExactKeys(record, ["sortNodeId", "fieldDefinitionId", "direction"]);
  if (record.direction !== "ascending" && record.direction !== "descending") {
    throw new Error("View sort direction must be ascending or descending");
  }
  return {
    sortNodeId: identity(record.sortNodeId, "View sort"),
    fieldDefinitionId: identity(record.fieldDefinitionId, "View sort Field Definition"),
    direction: record.direction,
  };
}

function parseGroup(value: unknown): ViewGroupSpec {
  const record = object(value, "View group");
  assertExactKeys(record, ["groupNodeId", "fieldDefinitionId"]);
  return {
    groupNodeId: identity(record.groupNodeId, "View group"),
    fieldDefinitionId: identity(record.fieldDefinitionId, "View group Field Definition"),
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function identity(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} identity must be a non-empty string`);
  }
  return value;
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const expected = new Set(keys);
  const unknown = Object.keys(value).find((key) => !expected.has(key));
  const missing = keys.find((key) => !(key in value));
  if (unknown !== undefined || missing !== undefined) {
    throw new Error(
      `View options shape is invalid${unknown === undefined ? "" : `: unknown ${unknown}`}${missing === undefined ? "" : `: missing ${missing}`}`,
    );
  }
}
