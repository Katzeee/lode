import type { SearchResultsQueryRequest, SearchResultsResult } from "@lode/sdk";
import { stableStringCompare } from "../../../domain/fact/index.js";
import { evaluateSearch, searchResultRowKey } from "../../../domain/query/index.js";
import type { ProjectionGeneration } from "../../../domain/reconcile/index.js";

export function querySearchResults(
  query: SearchResultsQueryRequest,
  generation: ProjectionGeneration,
): SearchResultsResult {
  const generationId = generation.identity.generationId;
  const projection = generation[query.perspective];
  const evaluated = evaluateSearch(query.searchNodeId, projection.searchExpressions[query.searchNodeId], projection);
  const after = query.after ?? null;
  const remaining =
    after === null ? evaluated.targets : evaluated.targets.filter((nodeId) => stableStringCompare(nodeId, after) > 0);
  const selected = remaining.slice(0, query.limit ?? 50);
  return {
    generationId,
    frontier: projection.identity.frontier,
    perspective: query.perspective,
    searchNodeId: query.searchNodeId,
    available: evaluated.available,
    results: selected.map((targetNodeId) => ({
      searchNodeId: query.searchNodeId,
      targetNodeId,
      rowKey: searchResultRowKey(query.searchNodeId, targetNodeId),
    })),
    next: remaining.length > selected.length ? (selected.at(-1) ?? null) : null,
  };
}
