import { SEARCH_NODE_TYPE, WORKSPACE_NODE_TYPE, type NodeType } from "../fact/index.js";
import { evaluateSearchClauses, searchResultRowKey } from "../query/index.js";
import { nodeLocation, type Projection } from "../reconcile/index.js";

export type ViewChildReference =
  | Readonly<{
      sourceKind: "occurrence";
      sourceIdentity: string;
      targetNodeId: string;
    }>
  | Readonly<{
      sourceKind: "search-result";
      sourceIdentity: string;
      targetNodeId: string;
    }>;

export function supportsSharedDefaultViewHost(nodeType: NodeType | null): boolean {
  return nodeType === null || nodeType === SEARCH_NODE_TYPE || nodeType === WORKSPACE_NODE_TYPE;
}

export function viewChildSource(hostNodeId: string, projection: Projection): readonly ViewChildReference[] {
  const host = projection.nodes[hostNodeId];
  if (
    host === undefined ||
    !supportsSharedDefaultViewHost(host.nodeType) ||
    nodeLocation(projection.identity.workspaceNodeId, projection, hostNodeId) !== "active"
  ) {
    return [];
  }
  if (projection.nodes[hostNodeId]?.nodeType === SEARCH_NODE_TYPE) {
    return evaluateSearchClauses(hostNodeId, projection.searchClauses[hostNodeId] ?? [], projection).map(
      (targetNodeId) => ({
        sourceKind: "search-result" as const,
        sourceIdentity: searchResultRowKey(hostNodeId, targetNodeId),
        targetNodeId,
      }),
    );
  }
  return (projection.childOccurrences[hostNodeId] ?? []).flatMap((occurrenceId) => {
    const occurrence = projection.occurrences[occurrenceId];
    return occurrence === undefined
      ? []
      : [
          {
            sourceKind: "occurrence" as const,
            sourceIdentity: occurrenceId,
            targetNodeId: occurrence.nodeId,
          },
        ];
  });
}
