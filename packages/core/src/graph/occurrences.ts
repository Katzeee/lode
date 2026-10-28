// Purpose: Reads a parent's ordered occurrences and whether each is an original or a reference.

import type { LoroTreeNode } from "loro-crdt";
import type { NodeId } from "../store/node-id.ts";
import { idOf, listedBy, refOf } from "../store/records.ts";
import { treeChildren } from "../store/store.ts";
import type { Graph } from "./graph.ts";
import { isPresent, ownerOf } from "./presence.ts";

/**
 * One listing of `node` under `parent`. Its link comes from ownership alone, not from whether storage
 * carries it as the owned node's key or as a reference leaf: a leaf under the node's own owner is an
 * original, and so is the Trash leaf of an undone creation, which reads as owned by Trash.
 */
export type Occurrence = { parent: NodeId; node: NodeId; link: "original" | "reference" };

/**
 * The parent's occurrences in order, each target once, at its first position. A parent that is not
 * present lists nothing. Duplicate leaves for one target, left by concurrent writes, read as one.
 */
export function occurrences(graph: Graph, parent: NodeId): Occurrence[] {
  const parentNode = graph.store.find(parent);
  if (!parentNode || !isPresent(graph, parent)) {
    return [];
  }
  const seen = new Set<NodeId>();
  const result: Occurrence[] = [];
  for (const child of treeChildren(parentNode)) {
    const target = listedTarget(graph, parent, child);
    if (target !== undefined && !seen.has(target)) {
      seen.add(target);
      result.push({ parent, node: target, link: ownerOf(graph, target) === parent ? "original" : "reference" });
    }
  }
  return result;
}

export function listedNodes(graph: Graph, parent: NodeId): NodeId[] {
  return occurrences(graph, parent).map((occurrence) => occurrence.node);
}

export function lists(graph: Graph, parent: NodeId, node: NodeId): boolean {
  return listedNodes(graph, parent).includes(node);
}

function listedTarget(graph: Graph, parent: NodeId, child: LoroTreeNode): NodeId | undefined {
  const ref = refOf(child);
  if (ref !== undefined) {
    return ref;
  }
  const id = idOf(child);
  return id !== undefined && listedBy(child, parent) && isPresent(graph, id) ? id : undefined;
}
