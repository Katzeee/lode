// Purpose: Reads a parent's ordered occurrences and whether each is an original or a reference.

import type { NodeId } from "../store/node-id.ts";
import { listingEntries } from "../store/listings.ts";
import { parentIdOf } from "../store/store.ts";
import type { Graph } from "./graph.ts";
import { isPresent, ownerOf } from "./presence.ts";

/**
 * One listing of `node` under `parent`. Its link comes from ownership alone: the owner's listing is
 * the original, any other a reference, and the Trash listing of an undone creation, which reads as
 * owned by Trash, is an original.
 */
export type Occurrence = { parent: NodeId; node: NodeId; link: "original" | "reference" };

/**
 * The parent's occurrences in its listing order, each target once, at its first entry. A parent that
 * is not present lists nothing. The parent's entry for a node it physically owns shows only while that
 * node is present, so the creation parent of an undone creation does not list it.
 */
export function occurrences(graph: Graph, parent: NodeId): Occurrence[] {
  if (graph.store.find(parent) === undefined || !isPresent(graph, parent)) {
    return [];
  }
  const seen = new Set<NodeId>();
  const result: Occurrence[] = [];
  for (const target of listingEntries(graph.store, parent)) {
    if (seen.has(target) || !shown(graph, parent, target)) {
      continue;
    }
    seen.add(target);
    result.push({ parent, node: target, link: ownerOf(graph, target) === parent ? "original" : "reference" });
  }
  return result;
}

export function listedNodes(graph: Graph, parent: NodeId): NodeId[] {
  return occurrences(graph, parent).map((occurrence) => occurrence.node);
}

export function lists(graph: Graph, parent: NodeId, node: NodeId): boolean {
  return listedNodes(graph, parent).includes(node);
}

function shown(graph: Graph, parent: NodeId, target: NodeId): boolean {
  const node = graph.store.find(target);
  return node === undefined || parentIdOf(node) !== parent || isPresent(graph, target);
}
