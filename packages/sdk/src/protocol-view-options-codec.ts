import type { ViewOptionsSpec } from "./model.js";
import { viewSortDirection } from "./protocol-enums/model.js";
import { fromSearchExpressionSpec, toSearchExpressionSpec } from "./protocol-search-expression-codec.js";
import { required } from "./protocol-shape-codec.js";

export function toViewOptionsSpec(options: ViewOptionsSpec): Record<string, unknown> {
  return {
    columns: options.columns,
    filter:
      options.filter === null
        ? null
        : { filterNodeId: options.filter.filterNodeId, expression: toSearchExpressionSpec(options.filter.expression) },
    sort:
      options.sort === null
        ? null
        : {
            sortNodeId: options.sort.sortNodeId,
            fieldDefinitionId: options.sort.fieldDefinitionId,
            direction: viewSortDirection.encode(options.sort.direction),
          },
    group: options.group,
  };
}

export function fromViewOptionsSpec(value: unknown): ViewOptionsSpec {
  const options = required(value as Record<string, unknown> | null, "View options");
  const filter = options.filter as Record<string, unknown> | null;
  const sort = options.sort as Record<string, unknown> | null;
  return {
    columns: (options.columns as readonly ViewOptionsSpec["columns"][number][] | undefined) ?? [],
    filter:
      filter === null || filter === undefined
        ? null
        : {
            filterNodeId: filter.filterNodeId as string,
            expression: fromSearchExpressionSpec(filter.expression),
          },
    sort:
      sort === null || sort === undefined
        ? null
        : {
            sortNodeId: sort.sortNodeId as string,
            fieldDefinitionId: sort.fieldDefinitionId as string,
            direction:
              typeof sort.direction === "string"
                ? (sort.direction as "ascending" | "descending")
                : viewSortDirection.decode(sort.direction as never),
          },
    group: (options.group as ViewOptionsSpec["group"] | null | undefined) ?? null,
  };
}
