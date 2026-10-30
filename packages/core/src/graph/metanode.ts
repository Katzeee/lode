// Purpose: Reads a host's metanode: its live candidates, the effective one, and whether a node is one.

import type { NodeId } from "../store/node-id.ts";
import type { Graph } from "./graph.ts";
import { ownerOf } from "./presence.ts";
import { compareIds, liveMetaRecords } from "./relations.ts";

/**
 * Live metanodes of `host`, smallest first, each owned by `host` (relations.ts). Concurrent first
 * writes can leave several; each is a candidate the tags are folded over, and none is rewritten
 * away. None means the host has no metanode, which is the test for creating one.
 */
export function metanodeTargets(graph: Graph, host: NodeId): NodeId[] {
  return [...new Set(liveMetaRecords(graph, host).map((record) => record.target))].sort(compareIds);
}

/** The smallest candidate: where writes through the pointer go, and what `hasMetaNode` tests. */
export function effectiveMetanode(graph: Graph, host: NodeId): NodeId | undefined {
  return metanodeTargets(graph, host)[0];
}

export function hasMetanode(graph: Graph, host: NodeId): boolean {
  return effectiveMetanode(graph, host) !== undefined;
}

/** True when `node`'s owner points at it, among that owner's candidates. */
export function isMetanode(graph: Graph, node: NodeId): boolean {
  const owner = ownerOf(graph, node);
  return owner !== undefined && metanodeTargets(graph, owner).includes(node);
}
