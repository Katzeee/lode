import { stableStringCompare } from "../fact/index.js";
import type { ProjectedNode } from "../reconcile/index.js";
import type { ViewChildReference } from "./view-child-source.js";

export function sortViewChildrenByNodeName(
  children: readonly ViewChildReference[],
  projection: Readonly<{ nodes: Readonly<Record<string, ProjectedNode>> }>,
): readonly ViewChildReference[] {
  return children
    .map((child, index) => ({ child, index, key: nodeNameSortKey(child.targetNodeId, projection) }))
    .sort((left, right) => stableStringCompare(left.key, right.key) || left.index - right.index)
    .map(({ child }) => child);
}

function nodeNameSortKey(
  nodeId: string,
  projection: Readonly<{ nodes: Readonly<Record<string, ProjectedNode>> }>,
): string {
  return (projection.nodes[nodeId]?.content ?? [])
    .flatMap((item) => (item.kind === "text" ? [item.value] : []))
    .join("")
    .toLowerCase();
}
