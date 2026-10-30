// Purpose: Stores each parent's ordered occurrences as a root movable list of target NodeIds, apart from ownership.

import type { LoroMovableList } from "loro-crdt";
import type { NodeId } from "./node-id.ts";
import type { Store } from "./store.ts";

/**
 * A parent's listing: `list:<parent>`, one entry per occurrence, in order. The tree parent records
 * ownership only, so a listing never depends on who owns its target, and an owner change never
 * touches a listing. A root container needs no creation operation, so no two replicas race to create
 * it. Concurrent inserts can leave one target twice; readers show it once, at its first entry.
 */
function listing(store: Store, parent: NodeId): LoroMovableList {
  return store.doc.getMovableList(`list:${parent}`);
}

/** The parent's entries in order, duplicates included. */
export function listingEntries(store: Store, parent: NodeId): NodeId[] {
  return listing(store, parent).toArray() as NodeId[];
}

/**
 * Inserts an entry for `target` at entry `index`, or at the end. Hidden and duplicate entries make an
 * entry index differ from a visible position; mapping one to the other is the caller's job.
 */
export function insertListing(store: Store, parent: NodeId, target: NodeId, index?: number): void {
  const entries = listing(store, parent);
  entries.insert(Math.min(index ?? entries.length, entries.length), target);
}

/**
 * Deletes every entry for `target` this replica sees and reports whether there was one. An entry
 * another replica inserts concurrently survives.
 */
export function deleteListings(store: Store, parent: NodeId, target: NodeId): boolean {
  const entries = listing(store, parent);
  const values = entries.toArray();
  let deleted = false;
  for (let index = values.length - 1; index >= 0; index--) {
    if (values[index] === target) {
      entries.delete(index, 1);
      deleted = true;
    }
  }
  return deleted;
}
