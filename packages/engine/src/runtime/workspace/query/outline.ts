import type { OutlineQueryRequest, OutlineResult } from "@lode/sdk";
import { nodeLocation, type Projection } from "../../../domain/reconcile/index.js";
import type { ProjectionGenerationReader } from "../../materialization/index.js";

const MAX_DEPTH = 32;

export async function queryOutline(
  query: OutlineQueryRequest,
  generationId: string,
  projections: ProjectionGenerationReader,
): Promise<OutlineResult> {
  if (!Number.isSafeInteger(query.maxDepth) || query.maxDepth < 1 || query.maxDepth > MAX_DEPTH) {
    throw new Error(`Outline maxDepth must be between 1 and ${MAX_DEPTH}`);
  }
  const generation = await projections.load(generationId);
  const projection = generation[query.perspective];
  const available =
    projection.nodes[query.rootNodeId] !== undefined &&
    nodeLocation(projection.identity.workspaceNodeId, projection, query.rootNodeId) === "active";
  const rows: OutlineResult["rows"][number][] = [];
  if (available) {
    unfold(query.rootNodeId, 1, [], query.maxDepth, projection, rows);
  }
  const after = query.after ?? null;
  const cursorIndex = after === null ? -1 : rows.findIndex((row) => row.rowKey === after);
  const remaining = after === null ? rows : cursorIndex < 0 ? [] : rows.slice(cursorIndex + 1);
  const selected = remaining.slice(0, query.limit ?? 50);
  return {
    generationId,
    frontier: projection.identity.frontier,
    perspective: query.perspective,
    rootNodeId: query.rootNodeId,
    rows: selected,
    next: remaining.length > selected.length ? (selected.at(-1)?.rowKey ?? null) : null,
    available,
  };
}

function unfold(
  parentNodeId: string,
  depth: number,
  path: readonly string[],
  maxDepth: number,
  projection: Projection,
  rows: OutlineResult["rows"][number][],
): void {
  for (const occurrenceId of projection.childOccurrences[parentNodeId] ?? []) {
    const occurrence = projection.occurrences[occurrenceId];
    if (occurrence === undefined) {
      continue;
    }
    const nextPath = [...path, occurrenceId];
    rows.push({
      rowKey: ["outline-row:v1", ...nextPath].map(encodeURIComponent).join(":"),
      occurrenceId,
      nodeId: occurrence.nodeId,
      parentNodeId,
      depth,
    });
    if (depth < maxDepth) {
      unfold(occurrence.nodeId, depth + 1, nextPath, maxDepth, projection, rows);
    }
  }
}
