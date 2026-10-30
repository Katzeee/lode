// Purpose: Decides whether a node is present and reads the facts presence gates, such as its owner and kind.

import type { NodeId } from "../store/node-id.ts";
import { hasSupport, kindOf, sourceOf, tupleDefinitionIdOf, type Kind } from "../store/records.ts";
import type { Graph } from "./graph.ts";

/**
 * A node is present while some command supports it, directly or through a node it physically owns:
 * the least set holding every supported node and closed under physical owner. Undoing a creation
 * removes the creator's support; another replica's support, or a supported owned node, keeps the node
 * and its creation facts readable. A present node's physical owner is therefore present. Read from
 * the document each time, so a command's uncommitted support and moves count at once. Concurrent
 * incarnations can form an ownership cycle; each query keeps its own visited set, so a cycle ends and
 * reads present exactly when something supported hangs in it.
 */
export function isPresent(graph: Graph, id: NodeId): boolean {
  return graph.store.has(id) && reachesSupport(graph, id, new Set());
}

function reachesSupport(graph: Graph, id: NodeId, visited: Set<NodeId>): boolean {
  if (visited.has(id)) {
    return false;
  }
  visited.add(id);
  return (
    hasSupport(graph.store, id) ||
    graph.store.ownership.ownedIds(id).some((owned) => reachesSupport(graph, owned, visited))
  );
}

/**
 * The owner a read sees. A node that is not present reads as an undone creation: owned by Trash,
 * whatever its physical owner. A node not in this document has no known owner.
 */
export function ownerOf(graph: Graph, id: NodeId): NodeId | undefined {
  if (!graph.store.has(id)) {
    return undefined;
  }
  return isPresent(graph, id) ? graph.store.ownership.physicalOwner(id) : graph.system.trash;
}

/** Kind and tuple definition are creation facts, absent while the node is not present. */
export function kindRead(graph: Graph, id: NodeId): Kind | undefined {
  return isPresent(graph, id) ? kindOf(graph.store, id) : undefined;
}

export function tupleDefinitionRead(graph: Graph, id: NodeId): NodeId | undefined {
  return isPresent(graph, id) ? tupleDefinitionIdOf(graph.store, id) : undefined;
}

/** The source stays readable after an undone creation: the reference system keeps it then too. */
export function sourceRead(graph: Graph, id: NodeId): NodeId | undefined {
  return sourceOf(graph.store, id);
}
