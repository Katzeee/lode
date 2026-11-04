// Purpose: Lists and unlists nodes under parents, the primitives every child-list change is built from.

import { effectivePair } from "../graph/associations.ts";
import type { Graph } from "../graph/graph.ts";
import { holderIsEmpty } from "../graph/emptiness.ts";
import { entryIndexForInsert, lists } from "../graph/occurrences.ts";
import { isPresent, ownerOf } from "../graph/presence.ts";
import { isTuple } from "../graph/tuples.ts";
import { deleteListings, insertListing, listingEntries } from "../store/listings.ts";
import { newNodeId, type NodeId } from "../store/node-id.ts";
import { dissociate } from "./associations.ts";
import { canList, canRemoveChild } from "./guards.ts";
import { setOwner } from "./owner.ts";
import { makeReal } from "./presence.ts";
import type { Writer } from "./writer.ts";

/**
 * Lists `node` under `parent` at visible `position`, or at the end; nothing when the parent already
 * lists it, and nothing under a system node. Only the parent is touched: a reference does not support
 * its target. A node that is not present and physically sits under `parent`, its undone creation, is
 * first made real without support, so it stays in Trash, not present, and the parent lists it as a
 * reference.
 */
export function listUnder(writer: Writer, node: NodeId, parent: NodeId, position?: number): void {
  const { graph, command } = writer;
  const { store } = graph;
  if (lists(graph, parent, node) || !canList(graph, parent)) {
    return;
  }
  const undoneHere = !isPresent(graph, node) && store.ownership.physicalOwner(node) === parent;
  writer.touch(parent);
  if (undoneHere) {
    makeReal(graph, command, node);
  }
  const index = position === undefined ? undefined : entryIndexForInsert(graph, parent, position);
  insertListing(store, parent, node, index);
}

/**
 * Deletes every entry for `node` this command observes under `parent`, hidden ones included; an entry
 * another replica inserts concurrently survives; nothing under a system node. Only the parent is
 * touched, so a node that is not present stays so.
 */
export function unlistFrom(writer: Writer, node: NodeId, parent: NodeId): void {
  const { graph } = writer;
  const { store } = graph;
  if (!canList(graph, parent) || !listingEntries(store, parent).includes(node)) {
    return;
  }
  writer.touch(parent);
  deleteListings(store, parent, node);
}

/** Lists `node` under `parent` unless it is listed there, adopting it first if it has no owner. */
export function addChild(writer: Writer, parent: NodeId, node: NodeId, position?: number): void {
  if (lists(writer.graph, parent, node)) {
    return;
  }
  adoptIfOwnerless(writer, node, parent);
  listUnder(writer, node, parent, position);
}

/**
 * `owner` becomes the owner of a node with no owner at all, as the owner guard allows. A node that is
 * not present reads as owned by Trash, so it has one.
 */
export function adoptIfOwnerless(writer: Writer, node: NodeId, owner: NodeId): void {
  const { graph } = writer;
  if (graph.store.has(node) && ownerOf(graph, node) === undefined) {
    setOwner(writer, node, owner);
  }
}

/** Whether `removeChild` would remove the occurrence: the parent lists the node and may remove it. */
export function removesChild(graph: Graph, parent: NodeId, node: NodeId): boolean {
  return lists(graph, parent, node) && canRemoveChild(graph, parent, node);
}

/**
 * Unlists `node` from `parent`; nothing when the parent does not list it, even if it owns it, and
 * nothing when the parent is a system node, or the root and the node one of its special nodes. A node the parent owned
 * becomes ownerless where the owner guard allows its release. A tuple that is no longer one gets a new
 * empty value. A holder now empty is dissociated by its owner when the owner hosts its pair.
 */
export function removeChild(writer: Writer, parent: NodeId, node: NodeId): void {
  const { graph } = writer;
  if (!removesChild(graph, parent, node)) {
    return;
  }
  const wasTuple = isTuple(graph, parent);
  unlistFrom(writer, node, parent);
  if (ownerOf(graph, node) === parent) {
    setOwner(writer, node, undefined);
  }
  if (wasTuple && !isTuple(graph, parent)) {
    writer.create([{ id: newNodeId(), parent, listed: true }]);
  }
  const pair = effectivePair(graph, parent);
  if (pair !== undefined && pair.host === ownerOf(graph, parent) && holderIsEmpty(graph, parent)) {
    dissociate(writer, pair.host, pair.subject, parent);
  }
}
