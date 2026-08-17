import type { SearchResultsQueryRequest, SearchResultsResult } from "@lode/sdk";
import { stableStringCompare } from "../../../domain/fact/index.js";
import { evaluateSearchExpression, searchResultRowKey } from "../../../domain/query/index.js";
import { nodeLocation } from "../../../domain/reconcile/index.js";
import type { ProjectionGenerationReader } from "../../materialization/index.js";

export async function querySearchResults(
  query: SearchResultsQueryRequest,
  generationId: string,
  projections: ProjectionGenerationReader,
): Promise<SearchResultsResult> {
  const generation = await projections.load(generationId);
  const projection = generation[query.perspective];
  const available =
    projection.nodes[query.searchNodeId]?.intrinsicNodeType === "search" &&
    nodeLocation(projection.identity.workspaceNodeId, projection, query.searchNodeId) === "active";
  const targets = available
    ? evaluateSearchExpression(query.searchNodeId, projection.searchExpressions[query.searchNodeId], projection)
    : [];
  const after = query.after ?? null;
  const remaining = after === null ? targets : targets.filter((nodeId) => stableStringCompare(nodeId, after) > 0);
  const selected = remaining.slice(0, query.limit ?? 50);
  return {
    generationId,
    frontier: projection.identity.frontier,
    perspective: query.perspective,
    searchNodeId: query.searchNodeId,
    available,
    results: selected.map((targetNodeId) => ({
      searchNodeId: query.searchNodeId,
      targetNodeId,
      rowKey: searchResultRowKey(query.searchNodeId, targetNodeId),
    })),
    next: remaining.length > selected.length ? (selected.at(-1) ?? null) : null,
  };
}
