import type { Backlink, BacklinksQueryRequest, BacklinksResult } from "@lode/sdk";
import { stableStringCompare } from "../../../domain/fact/index.js";
import { nodeLocation, type ProjectionGeneration } from "../../../domain/reconcile/index.js";
import type { ProjectionGenerationReader } from "../../materialization/index.js";

export async function queryBacklinks(
  query: BacklinksQueryRequest,
  generationId: string,
  projections: ProjectionGenerationReader,
): Promise<BacklinksResult> {
  const generation = await projections.load(generationId);
  const projection = generation[query.perspective];
  const targetStatus = targetLocation(projection, query.targetNodeId);
  const indexed = [
    ...blockBacklinks(projection, query.targetNodeId, targetStatus),
    ...inlineBacklinks(projection, query.targetNodeId),
  ].sort((left, right) => stableStringCompare(left.cursor, right.cursor));
  const after = query.after ?? null;
  const available = after === null ? indexed : indexed.filter((entry) => stableStringCompare(entry.cursor, after) > 0);
  const limit = query.limit ?? 50;
  const selected = available.slice(0, limit);
  return {
    generationId,
    frontier: projection.identity.frontier,
    perspective: query.perspective,
    targetNodeId: query.targetNodeId,
    backlinks: selected.map((entry) => entry.value),
    next: available.length > selected.length ? (selected.at(-1)?.cursor ?? null) : null,
  };
}

function blockBacklinks(
  projection: ProjectionGeneration["origin"],
  targetNodeId: string,
  targetStatus: Backlink["targetStatus"],
): readonly IndexedBacklink[] {
  return Object.values(projection.occurrences).flatMap((occurrence) =>
    occurrence.nodeId === targetNodeId && projection.nodeOwners[targetNodeId] !== occurrence.parentNodeId
      ? [
          {
            cursor: `block/${occurrence.occurrenceId}`,
            value: {
              sourceKind: "block" as const,
              sourceIdentity: occurrence.occurrenceId,
              hostNodeId: occurrence.parentNodeId,
              targetStatus,
            },
          },
        ]
      : [],
  );
}

function inlineBacklinks(projection: ProjectionGeneration["origin"], targetNodeId: string): readonly IndexedBacklink[] {
  return Object.values(projection.nodes).flatMap((node) =>
    node.content.flatMap((item) =>
      item.kind === "inline-reference" && item.targetNodeId === targetNodeId
        ? [
            {
              cursor: `inline/${item.id}`,
              value: {
                sourceKind: "inline" as const,
                sourceIdentity: item.id,
                hostNodeId: node.nodeId,
                targetStatus: item.targetStatus,
              },
            },
          ]
        : [],
    ),
  );
}

function targetLocation(projection: ProjectionGeneration["origin"], targetNodeId: string): Backlink["targetStatus"] {
  const location = nodeLocation(projection.identity.workspaceNodeId, projection, targetNodeId);
  return location === "absent" ? "unavailable" : location;
}

type IndexedBacklink = Readonly<{ cursor: string; value: Backlink }>;
