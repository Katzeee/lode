// Purpose: Allocates nodes and their initial relations in a commit excluded from undo.

import type { LoroTreeNode } from "loro-crdt";
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
 * step. A parent may be a node allocated earlier in the same call.
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
  const created = new Map<NodeId, LoroTreeNode>();
  const resolve = (id: NodeId) => created.get(id) ?? store.node(id);
  for (const spec of nodes) {
    const parent = spec.parent === undefined ? undefined : resolve(spec.parent);
    const node = parent ? parent.createNode() : store.tree.createNode();
    writeCreationFacts(node, spec);
    if (spec.parent !== undefined && spec.listed) {
      insertListing(store, spec.parent, spec.id, spec.index);
    }
    created.set(spec.id, node);
  }
  for (const { host, relation } of relations) {
    writeRelation(store, resolve(host), relation, command);
  }
  store.doc.commit({ origin: ALLOCATION });
}
