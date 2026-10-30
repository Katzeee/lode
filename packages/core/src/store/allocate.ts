// Purpose: Allocates nodes and their initial relations in a commit excluded from undo.

import type { CommandId } from "./command-id.ts";
import type { NodeId } from "./node-id.ts";
import { ALLOCATION } from "./origins.ts";
import { insertListing } from "./listings.ts";
import { writeCreationFacts, type CreationFacts } from "./records.ts";
import { writeRelation, type Relation } from "./relations.ts";
import type { Store } from "./store.ts";

/**
 * A node a command creates under its owner `parent`, or ownerless with none; `listed` lists it there
 * too, at entry `index` or at the end.
 */
export type Allocation = CreationFacts & { parent?: NodeId; index?: number; listed: boolean };

/** A relation the creating command establishes toward a node it creates, such as a host's metanode. */
export type AllocatedRelation = { host: NodeId; relation: Relation };

/**
 * Writes the creation facts of a command's new nodes in one commit the undo manager skips: undoing the
 * command removes its support for them, never the facts that give another replica's later writes
 * their meaning. Runs before the command's first undoable write, which keeps the command one undo
 * step.
 */
export function allocate(
  store: Store,
  command: CommandId,
  nodes: readonly Allocation[],
  relations: readonly AllocatedRelation[] = [],
): void {
  // A pending write would commit under the allocation origin and escape the command's undo step.
  if (store.doc.getPendingTxnLength() > 0) {
    throw new Error("allocation must precede the command's writes");
  }
  writeAllocation(store, command, nodes, relations);
  store.doc.commit({ origin: ALLOCATION });
}

/**
 * The one way a node comes to exist: its incarnation, creation facts, owner listing, and the relations
 * toward it, written into the open transaction for the caller to commit. A parent may be a node
 * allocated earlier in the same call. An id this replica already allocated, or one the call repeats,
 * is refused before anything is written: a second local incarnation would only split what one replica
 * created, so the caller checks `store.has` and decides. Another replica may still create the same
 * NodeId concurrently.
 */
export function writeAllocation(
  store: Store,
  command: CommandId,
  nodes: readonly Allocation[],
  relations: readonly AllocatedRelation[] = [],
): void {
  const ids = new Set<NodeId>();
  for (const { id } of nodes) {
    if (store.has(id) || ids.has(id)) {
      throw new Error(`node ${id} is already allocated`);
    }
    ids.add(id);
  }
  for (const spec of nodes) {
    store.ownership.create(spec.id, spec.parent);
    writeCreationFacts(store, spec);
    if (spec.parent !== undefined && spec.listed) {
      insertListing(store, spec.parent, spec.id, spec.index);
    }
  }
  for (const { host, relation } of relations) {
    writeRelation(store, host, relation, command);
  }
}
