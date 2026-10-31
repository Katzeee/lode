// Purpose: Reads a parent's ordered occurrences, whether each is an original or a reference, and maps visible positions to listing entry indexes.

import type { NodeId } from "../store/node-id.ts";
import { listingEntries } from "../store/listings.ts";
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
 * node is present, so the creation parent of an undone creation does not list it; Trash is the
 * exception and lists a node it physically owns while that node is not present.
 */
export function occurrences(graph: Graph, parent: NodeId): Occurrence[] {
  if (!isPresent(graph, parent)) {
    return [];
  }
  return visibleEntries(graph, parent, listingEntries(graph.store, parent)).map(({ target }) => ({
    parent,
    node: target,
    link: ownerOf(graph, target) === parent ? "original" : "reference",
  }));
}

export function listedNodes(graph: Graph, parent: NodeId): NodeId[] {
  return occurrences(graph, parent).map((occurrence) => occurrence.node);
}

export function lists(graph: Graph, parent: NodeId, node: NodeId): boolean {
  return listedNodes(graph, parent).includes(node);
}

/** The entry index at which an insert lands at visible `position`: before that occurrence's first entry, or at the end. */
export function entryIndexForInsert(graph: Graph, parent: NodeId, position: number): number {
  const entries = listingEntries(graph.store, parent);
  return visibleIn(graph, parent, entries)[position]?.index ?? entries.length;
}

/**
 * The final index for a Loro `move` of `target`'s entry to visible `position`, on the precondition that
 * the target's other entries are already deleted: computed on the list without the moved entry, the
 * first entry of the occurrence that will follow it, or that list's length when none follows.
 */
export function entryIndexForMove(graph: Graph, parent: NodeId, target: NodeId, position: number): number {
  const others = listingEntries(graph.store, parent).filter((entry) => entry !== target);
  return visibleIn(graph, parent, others)[position]?.index ?? others.length;
}

/** The visible entries of a parent that is present; one that is not lists nothing. */
function visibleIn(graph: Graph, parent: NodeId, entries: readonly NodeId[]): { index: number; target: NodeId }[] {
  return isPresent(graph, parent) ? visibleEntries(graph, parent, entries) : [];
}

/** Each visible target with the index of its first entry in `entries`, for a parent that is present. */
function visibleEntries(graph: Graph, parent: NodeId, entries: readonly NodeId[]): { index: number; target: NodeId }[] {
  const seen = new Set<NodeId>();
  const result: { index: number; target: NodeId }[] = [];
  for (const [index, target] of entries.entries()) {
    if (seen.has(target) || !shown(graph, parent, target)) {
      continue;
    }
    seen.add(target);
    result.push({ index, target });
  }
  return result;
}

function shown(graph: Graph, parent: NodeId, target: NodeId): boolean {
  return (
    parent === graph.system.trash || graph.store.ownership.physicalOwner(target) !== parent || isPresent(graph, target)
  );
}
