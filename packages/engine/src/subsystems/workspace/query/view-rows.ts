import type { ViewRowsQueryRequest, ViewRowsResult } from "@lode/sdk";
import {
  stableStringCompare,
  VIEW_SORT_NODE_NAME_NODE_ID,
  type ViewColumnSpec,
  type ViewGroupSpec,
} from "../../../domain/fact/index.js";
import { matchesSearchExpressionSpec } from "../../../domain/query/index.js";
import { nodeLocation } from "../../../domain/reconcile/index.js";
import type { Projection, ProjectionGeneration } from "../../../domain/reconcile/index.js";
import {
  sortViewChildrenByNodeName,
  supportsSharedDefaultViewHost,
  viewChildSource,
  type ViewChildReference,
} from "../../../domain/view/index.js";

export function queryViewRows(query: ViewRowsQueryRequest, generation: ProjectionGeneration): ViewRowsResult {
  const generationId = generation.identity.generationId;
  const projection = generation[query.perspective];
  const host = projection.nodes[query.hostNodeId];
  const hostAvailable =
    host !== undefined &&
    supportsSharedDefaultViewHost(host.intrinsicNodeType) &&
    nodeLocation(projection.identity.workspaceNodeId, projection, query.hostNodeId) === "active";
  const definitions = projection.sharedDefaultViewDefinitions[query.hostNodeId] ?? [];
  const selectedDefinition =
    query.viewDefinitionNodeId === undefined
      ? definitions.length === 0
        ? null
        : definitions.length === 1
          ? definitions[0]
          : undefined
      : definitions.find((definition) => definition.viewDefinitionNodeId === query.viewDefinitionNodeId);
  const available = hostAvailable && selectedDefinition !== undefined;
  const selectedDefinitionNodeId = selectedDefinition?.viewDefinitionNodeId ?? null;
  const options = selectedDefinition?.options ?? { columns: [], filter: null, sort: null, group: null };
  const optionsConflicted = selectedDefinition?.optionsConflicted ?? false;
  const rawChildSource = available && !optionsConflicted ? viewChildSource(query.hostNodeId, projection) : [];
  const filteredChildSource =
    selectedDefinition?.viewType !== "table" || options.filter === null
      ? rawChildSource
      : rawChildSource.filter((source) =>
          matchesSearchExpressionSpec(source.targetNodeId, options.filter!.expression, projection, query.hostNodeId),
        );
  const sortedChildSource =
    selectedDefinition?.viewType === "table" && options.sort !== null
      ? options.sort.fieldDefinitionId === VIEW_SORT_NODE_NAME_NODE_ID
        ? sortByNodeName(filteredChildSource, options.sort.direction, projection)
        : sortByField(filteredChildSource, options.sort.fieldDefinitionId, options.sort.direction, projection)
      : filteredChildSource;
  const childSource =
    selectedDefinition?.viewType === "table" && options.group !== null
      ? sortByGroup(sortedChildSource, options.group.fieldDefinitionId, projection)
      : sortedChildSource;
  const rows = childSource.map((source) =>
    viewRow(query.hostNodeId, selectedDefinitionNodeId, source, options.columns, options.group, projection),
  );
  const after = query.after ?? null;
  const cursorIndex = after === null ? -1 : rows.findIndex((row) => row.rowKey === after);
  const remaining = after === null ? rows : cursorIndex < 0 ? [] : rows.slice(cursorIndex + 1);
  const selected = remaining.slice(0, query.limit ?? 50);
  return {
    generationId,
    frontier: projection.identity.frontier,
    perspective: query.perspective,
    hostNodeId: query.hostNodeId,
    viewDefinitionNodeId: selectedDefinitionNodeId,
    viewType: selectedDefinition?.viewType ?? "outline",
    available,
    options,
    optionsConflicted,
    rows: selected,
    next: remaining.length > selected.length ? (selected.at(-1)?.rowKey ?? null) : null,
  };
}

function sortByNodeName(
  children: readonly ViewChildReference[],
  direction: "ascending" | "descending",
  projection: Projection,
): readonly ViewChildReference[] {
  const ascending = sortViewChildrenByNodeName(children, projection);
  return direction === "ascending" ? ascending : [...ascending].reverse();
}

function viewRow(
  hostNodeId: string,
  viewDefinitionNodeId: string | null,
  source: ViewChildReference,
  columns: readonly ViewColumnSpec[],
  group: ViewGroupSpec | null,
  projection: Projection,
): ViewRowsResult["rows"][number] {
  const viewIdentity = viewDefinitionNodeId ?? `implicit-outline:${hostNodeId}`;
  return {
    rowKey: ["view-row:v1", viewIdentity, source.sourceKind, source.sourceIdentity].map(encodeURIComponent).join(":"),
    targetNodeId: source.targetNodeId,
    sourceKind: source.sourceKind,
    sourceIdentity: source.sourceIdentity,
    cells: columns.map((column) => viewCell(source.targetNodeId, column, projection)),
    group: group === null ? null : viewGroup(source.targetNodeId, group, projection),
  };
}

function viewCell(
  targetNodeId: string,
  column: ViewColumnSpec,
  projection: Projection,
): ViewRowsResult["rows"][number]["cells"][number] {
  const field = (projection.materializedFields[targetNodeId] ?? []).find(
    (candidate) => candidate.fieldDefinitionId === column.fieldDefinitionId,
  );
  return {
    columnNodeId: column.columnNodeId,
    fieldDefinitionId: column.fieldDefinitionId,
    fieldNodeId: field?.fieldNodeId ?? null,
    valueNodeIds:
      field?.valueOccurrenceIds.flatMap((occurrenceId) => {
        const occurrence = projection.occurrences[occurrenceId];
        return occurrence === undefined ? [] : [occurrence.nodeId];
      }) ?? [],
  };
}

function viewGroup(
  targetNodeId: string,
  group: ViewGroupSpec,
  projection: Projection,
): NonNullable<ViewRowsResult["rows"][number]["group"]> {
  const values = fieldSemanticValues(targetNodeId, group.fieldDefinitionId, projection);
  return {
    groupNodeId: group.groupNodeId,
    fieldDefinitionId: group.fieldDefinitionId,
    key: values.keys.join("|") || "empty",
    valueNodeIds: values.valueNodeIds,
  };
}

function sortByField(
  children: readonly ViewChildReference[],
  fieldDefinitionId: string,
  direction: "ascending" | "descending",
  projection: Projection,
): readonly ViewChildReference[] {
  const multiplier = direction === "ascending" ? 1 : -1;
  return children
    .map((child, index) => ({
      child,
      index,
      key: fieldSemanticValues(child.targetNodeId, fieldDefinitionId, projection).keys.join("|"),
    }))
    .sort((left, right) => multiplier * stableStringCompare(left.key, right.key) || left.index - right.index)
    .map(({ child }) => child);
}

function sortByGroup(
  children: readonly ViewChildReference[],
  fieldDefinitionId: string,
  projection: Projection,
): readonly ViewChildReference[] {
  return sortByField(children, fieldDefinitionId, "ascending", projection);
}

function fieldSemanticValues(
  nodeId: string,
  fieldDefinitionId: string,
  projection: Projection,
): Readonly<{ keys: readonly string[]; valueNodeIds: readonly string[] }> {
  const typed = (projection.typedFieldValues[nodeId] ?? []).filter(
    (field) => field.fieldDefinitionId === fieldDefinitionId && field.state === "value",
  );
  if (typed.length > 0) {
    return {
      keys: typed.map((field) => {
        if (field.state !== "value") {
          return "";
        }
        return field.value.kind === "options-from-supertag"
          ? `node:${field.value.targetNodeId}`
          : `${field.value.kind}:${String(field.value.value)}`;
      }),
      valueNodeIds: typed.flatMap((field) => (field.state === "value" ? [field.value.valueNodeId] : [])),
    };
  }
  const fields = (projection.materializedFields[nodeId] ?? []).filter(
    (field) => field.fieldDefinitionId === fieldDefinitionId,
  );
  const valueNodeIds = fields.flatMap((field) =>
    field.valueOccurrenceIds.flatMap((occurrenceId) => {
      const occurrence = projection.occurrences[occurrenceId];
      return occurrence === undefined ? [] : [occurrence.nodeId];
    }),
  );
  return {
    keys: valueNodeIds.map((valueNodeId) =>
      (projection.nodes[valueNodeId]?.content ?? [])
        .flatMap((item) => (item.kind === "text" ? [item.value] : []))
        .join("")
        .toLocaleLowerCase(),
    ),
    valueNodeIds,
  };
}
