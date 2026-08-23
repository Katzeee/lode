import type { ViewOptionsSpec } from "./model.js";
import { viewSortDirection } from "./protocol-enums/model.js";
import { fromSearchExpressionSpec, toSearchExpressionSpec } from "./protocol-search-expression-codec.js";
import { required } from "./protocol-shape-codec.js";
import { factActionId } from "./fact-identities.js";

export function toViewOptionsSpec(options: ViewOptionsSpec): Record<string, unknown> {
  return {
    columns: options.columns,
    filter:
      options.filter === null
        ? null
        : {
            filterId: options.filter.filterId,
            filterNodeId: options.filter.filterNodeId,
            expression: toSearchExpressionSpec(options.filter.expression),
          },
    sort:
      options.sort === null
        ? null
        : {
            sortId: options.sort.sortId,
            sortNodeId: options.sort.sortNodeId,
            fieldDefinitionId: options.sort.fieldDefinitionId,
            direction: viewSortDirection.encode(options.sort.direction),
          },
    group: options.group,
  };
}

export function fromViewOptionsSpec(value: unknown): ViewOptionsSpec {
  const options = required(value as Record<string, unknown> | null, "View options");
  const filter = options.filter === null || options.filter === undefined ? null : record(options.filter, "View filter");
  const sort = options.sort === null || options.sort === undefined ? null : record(options.sort, "View sort");
  const group = options.group === null || options.group === undefined ? null : record(options.group, "View group");
  return {
    columns: array(options.columns, "View columns").map((value) => {
      const column = record(value, "View column");
      return {
        columnId: factActionId(column.columnId, "View column identity"),
        columnNodeId: string(column.columnNodeId, "View column Node identity"),
        fieldDefinitionId: string(column.fieldDefinitionId, "View column Field Definition identity"),
      };
    }),
    filter:
      filter === null || filter === undefined
        ? null
        : {
            filterId: factActionId(filter.filterId, "View filter identity"),
            filterNodeId: string(filter.filterNodeId, "View filter Node identity"),
            expression: fromSearchExpressionSpec(filter.expression),
          },
    sort:
      sort === null || sort === undefined
        ? null
        : {
            sortId: factActionId(sort.sortId, "View sort identity"),
            sortNodeId: string(sort.sortNodeId, "View sort Node identity"),
            fieldDefinitionId: string(sort.fieldDefinitionId, "View sort Field Definition identity"),
            direction:
              typeof sort.direction === "string"
                ? (sort.direction as "ascending" | "descending")
                : viewSortDirection.decode(sort.direction as never),
          },
    group:
      group === null
        ? null
        : {
            groupId: factActionId(group.groupId, "View group identity"),
            groupNodeId: string(group.groupNodeId, "View group Node identity"),
            fieldDefinitionId: string(group.fieldDefinitionId, "View group Field Definition identity"),
          },
  };
}

function array(value: unknown, label: string): readonly unknown[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}
