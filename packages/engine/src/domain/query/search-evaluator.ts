import { stableStringCompare } from "../fact/index.js";
import type { Projection, SearchClause } from "../reconcile/index.js";
import { nodeLocation } from "../reconcile/index.js";

export function evaluateSearchClauses(
  searchNodeId: string,
  clauses: readonly SearchClause[],
  projection: Projection,
): readonly string[] {
  if (
    projection.nodes[searchNodeId]?.nodeType !== "search" ||
    nodeLocation(projection.identity.workspaceNodeId, projection, searchNodeId) !== "active" ||
    clauses.length === 0
  ) {
    return [];
  }
  return Object.keys(projection.nodes)
    .filter((nodeId) => isSearchableNode(nodeId, projection))
    .filter((nodeId) => clauses.every((clause) => matchesClause(nodeId, clause, projection)))
    .sort(stableStringCompare);
}

export function searchResultRowKey(searchNodeId: string, targetNodeId: string): string {
  return `search-result:v1:${encodeURIComponent(searchNodeId)}:${encodeURIComponent(targetNodeId)}`;
}

function matchesClause(nodeId: string, clause: SearchClause, projection: Projection): boolean {
  if (clause.kind === "supertag-instance-of") {
    const matchingSupertags = new Set(projection.supertagInstanceSupertags[clause.supertagId] ?? [clause.supertagId]);
    return (projection.supertagApplications[nodeId] ?? []).some((supertagId) => matchingSupertags.has(supertagId));
  }
  return (projection.materializedFields[nodeId] ?? []).some(
    (field) => field.fieldDefinitionId === clause.fieldDefinitionId,
  );
}

function isSearchableNode(nodeId: string, projection: Projection): boolean {
  if (nodeLocation(projection.identity.workspaceNodeId, projection, nodeId) !== "active") {
    return false;
  }
  const metanodes = new Set(Object.values(projection.metanodes));
  let cursor: string | null | undefined = nodeId;
  const seen = new Set<string>();
  while (cursor !== null && cursor !== undefined && !seen.has(cursor)) {
    if (metanodes.has(cursor)) {
      return false;
    }
    seen.add(cursor);
    cursor = projection.nodeOwners[cursor];
  }
  const ownerNodeId = projection.nodeOwners[nodeId];
  return (
    ownerNodeId !== null &&
    ownerNodeId !== undefined &&
    Object.values(projection.occurrences).some(
      (occurrence) => !occurrence.derived && occurrence.nodeId === nodeId && occurrence.parentNodeId === ownerNodeId,
    )
  );
}
