// Purpose: Changes a node's owner while keeping every listing, trashes nodes, and moves or reorders a node's occurrence.

import { effectiveHolder } from "../graph/associations.ts";
import { inlineNodes } from "../graph/inline.ts";
import { entryIndexForMove, listedNodes, lists } from "../graph/occurrences.ts";
import { isPresent, ownerOf } from "../graph/presence.ts";
import { deleteLaterListings, deleteListings, insertListing, listingEntries, moveListing } from "../store/listings.ts";
import type { NodeId } from "../store/node-id.ts";
import { setAssociatedDataFor } from "./associations.ts";
import { canChangeOwner, canList, canRemoveChild } from "./guards.ts";
import { listUnder, removeChild } from "./listing.ts";
import type { Writer } from "./writer.ts";

/**
 * Sets the owner only, or releases it (`owner` undefined), as the owner guard allows. No listing is
 * touched: the old owner's entry now reads as a reference and the new owner's as the original, so a
 * refused or raced change loses no listing. Returns whether the owner is now `owner`; a refused or
 * unchanged owner writes nothing and adds no support. A new owner that is not present is made real
 * before the node's support would make it present with its creation context, and the node is supported
 * once it hangs under its new owner chain.
 */
export function setOwner(writer: Writer, node: NodeId, owner: NodeId | undefined): boolean {
  const { graph } = writer;
  if (ownerOf(graph, node) === owner || !canChangeOwner(graph, node, owner)) {
    return false;
  }
  if (owner !== undefined && !isPresent(graph, owner)) {
    writer.touch(owner);
  }
  if (!isPresent(graph, node)) {
    writer.touch(node);
  }
  graph.store.ownership.moveOwner(node, owner);
  writer.touch(node);
  return ownerOf(graph, node) === owner;
}

/**
 * Trash becomes the owner, then lists the node at its top: the command deletes the Trash entries for
 * the node it observes and inserts one at entry 0. Two replicas trashing a node concurrently leave two
 * entries, which read once. Refused where the owner guard refuses Trash as the owner.
 */
export function moveToTrash(writer: Writer, node: NodeId): boolean {
  const { graph } = writer;
  const { store, system } = graph;
  if (!canChangeOwner(graph, node, system.trash)) {
    return false;
  }
  setOwner(writer, node, system.trash);
  writer.touch(system.trash);
  deleteListings(store, system.trash, node);
  insertListing(store, system.trash, node, 0);
  return true;
}

/**
 * Moves the occurrence of `node` under `from` to visible `position` under `to`, or to the end; within
 * one parent it reorders. Returns whether the move is accepted; nothing moves into or within a system
 * node, whose listing is never written.
 *
 * Between parents every refusal is decided before any write: `from` does not list the node or may not
 * remove it, `to` is the node or already lists it, the node is an original at `from` whose owner
 * cannot become `to` (a cycle, or the owner guard), or the contextual holder cannot follow. That holder
 * is `from`'s holder for the node unless `from`'s name mentions it inline; it cannot follow when `to`
 * already has one or would refuse it as owner. Then the holder moves, its owner and host becoming
 * `to`; the node's owner becomes `to` when `from` owned it or it had none; `to` lists it; and `from`
 * removes it as removing a child does, an empty value and a holder release included.
 */
export function moveChildTo(writer: Writer, node: NodeId, from: NodeId, to: NodeId, position?: number): boolean {
  const { graph } = writer;
  if (!lists(graph, from, node) || !canList(graph, to)) {
    return false;
  }
  if (from === to) {
    reorder(writer, node, from, position);
    return true;
  }
  const owner = ownerOf(graph, node);
  if (
    !canRemoveChild(graph, from, node) ||
    to === node ||
    lists(graph, to, node) ||
    (owner === from && !canChangeOwner(graph, node, to))
  ) {
    return false;
  }
  const holder = inlineNodes(graph, from).includes(node) ? undefined : effectiveHolder(graph, from, node);
  if (holder !== undefined && (effectiveHolder(graph, to, node) !== undefined || !canChangeOwner(graph, holder, to))) {
    return false;
  }
  // The source is written before any owner change: moving the node or its holder away can take the
  // source's last support, and a source no longer present would skip removing the occurrence.
  writer.touch(from);
  if (holder !== undefined) {
    setAssociatedDataFor(writer, to, node, holder);
  }
  if (owner === from || owner === undefined) {
    setOwner(writer, node, to);
  }
  listUnder(writer, node, to, position);
  removeChild(writer, from, node);
  return true;
}

/**
 * Moves the node's one entry with Loro's list move, after deleting its other observed entries, so the
 * last writer wins: two concurrent reorders leave one entry, and a reorder racing an unlist keeps the
 * node, where a delete and insert would leave duplicates (Lode's policy for a state only concurrency
 * reaches). A final visible position equal to the current one writes nothing, so a tuple's only value
 * gains no empty value. An owned node is supported, so a reorder racing its creator's Undo keeps it; a
 * reference's reorder writes the parent only.
 */
function reorder(writer: Writer, node: NodeId, parent: NodeId, position: number | undefined): void {
  const { graph } = writer;
  const { store } = graph;
  const listed = listedNodes(graph, parent);
  const last = listed.length - 1;
  const final = Math.min(position ?? last, last);
  if (final === listed.indexOf(node)) {
    return;
  }
  writer.touch(parent);
  if (ownerOf(graph, node) === parent) {
    writer.touch(node);
  }
  deleteLaterListings(store, parent, node);
  moveListing(
    store,
    parent,
    listingEntries(store, parent).indexOf(node),
    entryIndexForMove(graph, parent, node, final),
  );
}
