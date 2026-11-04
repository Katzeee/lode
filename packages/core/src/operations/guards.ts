// Purpose: Decides which owner changes, child removals and deletions the workspace's structure allows.

import type { Graph } from "../graph/graph.ts";
import { ownerOf } from "../graph/presence.ts";
import { isSystemNode } from "../graph/system-nodes.ts";
import type { NodeId } from "../store/node-id.ts";

/** Trash and Schema: the root's special nodes, which stay under the root and listed by it. */
function isSpecialRootNode(graph: Graph, id: NodeId): boolean {
  return id === graph.system.trash || id === graph.system.schema;
}

/**
 * The owner guard every owner change passes, setting an owner or releasing one (`owner` undefined).
 * System nodes are the definition roles and what genesis derives from them; the containers are not
 * system nodes and keep rules of their own. Refused: the root, which stays unowned; a system node,
 * which the reference system keeps in a read-only file of its own; an owner that is a system node, so
 * nothing ordinary moves under one; Trash or Schema leaving the root; and a change the tree refuses,
 * a cycle found by walking NodeIds up from the new owner with a visited set, or a cyclic move of the
 * canonical incarnation. An owner the node already has passes.
 */
export function canChangeOwner(graph: Graph, node: NodeId, owner: NodeId | undefined): boolean {
  const { store, system } = graph;
  if (node === system.root || isSystemNode(system, node) || (owner !== undefined && isSystemNode(system, owner))) {
    return false;
  }
  const leavesRoot = isSpecialRootNode(graph, node) && owner !== system.root;
  return !leavesRoot && store.ownership.canMoveOwner(node, owner);
}

/**
 * A system node's listing is never changed, and the root never removes its special nodes; any other
 * occurrence can be removed, a reference to a system node included. Decided before any write, so
 * removing a system tuple's last value never reaches the empty value it would insert.
 */
export function canRemoveChild(graph: Graph, parent: NodeId, node: NodeId): boolean {
  return canList(graph, parent) && !(parent === graph.system.root && isSpecialRootNode(graph, node));
}

/**
 * Nothing is listed under a system node, removed from one, nor reordered there: the reference system
 * keeps the system nodes in a read-only file of their own, so no workspace write reaches their listings.
 */
export function canList(graph: Graph, parent: NodeId): boolean {
  return !isSystemNode(graph.system, parent);
}

/**
 * Deletion is refused from Trash and from a system node, and for Home's own listing. Nothing is refused
 * for the node alone: the owner guard and the root's removal rule protect the structural nodes where
 * their position would change.
 */
export function canDelete(graph: Graph, node: NodeId, parent: NodeId): boolean {
  const { home, trash } = graph.system;
  return parent !== trash && !isSystemNode(graph.system, parent) && !(node === home && ownerOf(graph, node) === parent);
}
