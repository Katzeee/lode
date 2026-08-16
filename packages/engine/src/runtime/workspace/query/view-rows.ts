import type { ViewRowsQueryRequest, ViewRowsResult } from "@lode/sdk";
import { nodeLocation } from "../../../domain/reconcile/index.js";
import { supportsSharedDefaultViewHost, viewChildSource, type ViewChildReference } from "../../../domain/view/index.js";
import type { ProjectionGenerationReader } from "../../materialization/index.js";

export async function queryViewRows(
  query: ViewRowsQueryRequest,
  generationId: string,
  projections: ProjectionGenerationReader,
): Promise<ViewRowsResult> {
  const generation = await projections.load(generationId);
  const projection = generation[query.perspective];
  const host = projection.nodes[query.hostNodeId];
  const hostAvailable =
    host !== undefined &&
    supportsSharedDefaultViewHost(host.nodeType) &&
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
  const childSource = available ? viewChildSource(query.hostNodeId, projection) : [];
  const rows = childSource.map((source) => viewRow(query.hostNodeId, selectedDefinitionNodeId, source));
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
    rows: selected,
    next: remaining.length > selected.length ? (selected.at(-1)?.rowKey ?? null) : null,
  };
}

function viewRow(
  hostNodeId: string,
  viewDefinitionNodeId: string | null,
  source: ViewChildReference,
): ViewRowsResult["rows"][number] {
  const viewIdentity = viewDefinitionNodeId ?? `implicit-outline:${hostNodeId}`;
  return {
    rowKey: ["view-row:v1", viewIdentity, source.sourceKind, source.sourceIdentity].map(encodeURIComponent).join(":"),
    targetNodeId: source.targetNodeId,
    sourceKind: source.sourceKind,
    sourceIdentity: source.sourceIdentity,
  };
}
