// Purpose: Decides whether a node is present and reads the facts presence gates, such as its owner and kind.

import type { LoroTreeNode } from "loro-crdt";
import type { NodeId } from "../store/node-id.ts";
import { kindOf, sourceOf, supportsOf, tupleDefinitionIdOf, type Kind } from "../store/records.ts";
import { parentIdOf, treeChildren } from "../store/store.ts";
import type { Graph } from "./graph.ts";

/**
 * A node is present while some command supports it, directly or through a present descendant. Undoing
 * a creation removes the creator's support; another replica's support, or a supported descendant,
 * keeps the node and its creation facts readable. Presence is closed upward: a present node's parent
 * is present.
 */
export function isPresent(graph: Graph, id: NodeId): boolean {
  const node = graph.store.find(id);
  return node !== undefined && supported(node);
}

function supported(node: LoroTreeNode): boolean {
  return supportsOf(node).size > 0 || treeChildren(node).some(supported);
}

/**
 * The owner a read sees. A node that is not present reads as an undone creation: owned by Trash,
 * whatever its physical parent. A node not in this document has no known owner.
 */
export function ownerOf(graph: Graph, id: NodeId): NodeId | undefined {
  const node = graph.store.find(id);
  if (!node) {
    return undefined;
  }
  return supported(node) ? parentIdOf(node) : graph.system.trash;
}

/** Kind and tuple definition are creation facts, absent while the node is not present. */
export function kindRead(graph: Graph, id: NodeId): Kind | undefined {
  const node = graph.store.find(id);
  return node && supported(node) ? kindOf(node) : undefined;
}

export function tupleDefinitionRead(graph: Graph, id: NodeId): NodeId | undefined {
  const node = graph.store.find(id);
  return node && supported(node) ? tupleDefinitionIdOf(node) : undefined;
}

/** The source stays readable after an undone creation: the reference system keeps it then too. */
export function sourceRead(graph: Graph, id: NodeId): NodeId | undefined {
  const node = graph.store.find(id);
  return node && sourceOf(node);
}
