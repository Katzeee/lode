// Purpose: Reads a host's metanode: the raw relation, its effective metanode and where writes go.

import type { NodeId } from "../store/node-id.ts";
import type { Graph } from "./graph.ts";
import { ownerOf } from "./presence.ts";
import { compareIds, liveMetaRecords } from "./relations.ts";

/**
 * Live metanode targets of `host`, smallest first. Concurrent first writes can leave several; each is
 * a candidate and none is rewritten away. A raw relation exists when this is non-empty, which is the
 * test for creating a metanode.
 */
export function metanodeTargets(graph: Graph, host: NodeId): NodeId[] {
  return [...new Set(liveMetaRecords(graph, host).map((record) => record.target))].sort(compareIds);
}

/** The candidates `host` owns: the metanodes its tags are folded over. */
export function ownedMetanodes(graph: Graph, host: NodeId): NodeId[] {
  return metanodeTargets(graph, host).filter((target) => ownerOf(graph, target) === host);
}

/** The smallest owned candidate; undefined when `hasMetaNode` would be false. */
export function effectiveMetanode(graph: Graph, host: NodeId): NodeId | undefined {
  return ownedMetanodes(graph, host)[0];
}

export function hasMetanode(graph: Graph, host: NodeId): boolean {
  return effectiveMetanode(graph, host) !== undefined;
}

/**
 * Where a write through the pointer goes: the smallest live target, owned by `host` or not, as the
 * reference system writes to the pointer's target whatever owns it.
 */
export function metanodeWriteTarget(graph: Graph, host: NodeId): NodeId | undefined {
  return metanodeTargets(graph, host)[0];
}

/** True when `node`'s owner points back at it, among that owner's candidates. */
export function isMetanode(graph: Graph, node: NodeId): boolean {
  const owner = ownerOf(graph, node);
  return owner !== undefined && ownedMetanodes(graph, owner).includes(node);
}
