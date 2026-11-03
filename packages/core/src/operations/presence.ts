// Purpose: Stores the read state of a node that is not present in a command's own undoable writes before the command writes into it.

import type { Graph } from "../graph/graph.ts";
import { peerOf, type CommandId } from "../store/command-id.ts";
import { deleteListings, insertListing, listingEntries } from "../store/listings.ts";
import type { NodeId } from "../store/node-id.ts";
import { writeReal } from "../store/records.ts";
import { deleteRelationRecords, relationRecords, type RelationRecord } from "../store/relations.ts";
import { nameText } from "../store/text.ts";

/**
 * Makes real the state a node that is not present reads with: no children, owned and listed by Trash,
 * no gated creation facts, no name and no relations, keeping its source. Writing into it then never
 * revives its creation context. Adds no support: `touch` supports the node afterwards, while listing a
 * reference to it leaves it not present. Every step deletes only what this replica observes, so a
 * concurrent insert survives, and all of it is the command's own undoable writes, which its Undo
 * reverts.
 */
export function makeReal(graph: Graph, command: CommandId, id: NodeId): void {
  const { store, system } = graph;
  // Children another replica promoted away would otherwise revive as references once the node is present.
  for (const target of new Set(listingEntries(store, id))) {
    deleteListings(store, id, target);
  }
  const parent = store.ownership.physicalOwner(id);
  if (parent !== undefined && parent !== system.trash) {
    deleteListings(store, parent, id);
  }
  store.ownership.moveOwner(id, system.trash);
  // The creator's history commit may not have arrived; its later entry is a duplicate, read once.
  if (!listingEntries(store, system.trash).includes(id)) {
    insertListing(store, system.trash, id, 0);
  }
  // One key per peer gates kind, definition and description and carries the name state: a single
  // cleared value would come back with one replica's Undo while another's make-real keeps the node.
  writeReal(store, id, peerOf(command));
  const name = nameText(store, id);
  if (name.length > 0) {
    name.delete(0, name.length);
  }
  const stale = (record: RelationRecord) => record.command !== command;
  deleteRelationRecords(store, id, relationRecords(store, id).filter(stale));
  const incoming = Map.groupBy(store.holders.recordsOf(id).filter(stale), (record) => record.host);
  for (const [host, records] of incoming) {
    deleteRelationRecords(store, host, records);
  }
}
