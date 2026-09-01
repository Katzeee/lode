import { SEARCH_INTRINSIC_NODE_TYPE, WORKSPACE_INTRINSIC_NODE_TYPE, type IntrinsicNodeType } from "../fact/index.js";
import { evaluateSearch, searchResultRowKey } from "../query/index.js";
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

export function supportsSharedDefaultViewHost(intrinsicNodeType: IntrinsicNodeType | null): boolean {
  return (
    intrinsicNodeType === null ||
    intrinsicNodeType === SEARCH_INTRINSIC_NODE_TYPE ||
    intrinsicNodeType === WORKSPACE_INTRINSIC_NODE_TYPE
  );
}

export function viewChildSource(hostNodeId: string, projection: Projection): readonly ViewChildReference[] {
  const host = projection.nodes[hostNodeId];
  if (host === undefined || !supportsSharedDefaultViewHost(host.intrinsicNodeType)) {
    return [];
  }
  if (host.intrinsicNodeType === SEARCH_INTRINSIC_NODE_TYPE) {
    const evaluated = evaluateSearch(hostNodeId, projection.searchExpressions[hostNodeId], projection);
    return evaluated.targets.map((targetNodeId) => ({
      sourceKind: "search-result" as const,
      sourceIdentity: searchResultRowKey(hostNodeId, targetNodeId),
      targetNodeId,
    }));
  }
  if (nodeLocation(projection.identity.workspaceNodeId, projection, hostNodeId) !== "active") {
    return [];
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
