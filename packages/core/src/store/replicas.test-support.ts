// Purpose: Builds test replicas and coordinates their command commits and update exchange.

import { UndoManager } from "loro-crdt";
import { nextCommandId, type CommandId } from "./command-id.ts";
import type { NodeId } from "./node-id.ts";
import { COMMAND, EXCLUDED, GENESIS } from "./origins.ts";
import { insertListing } from "./listings.ts";
import { writeCreationFacts } from "./records.ts";
import { Store } from "./store.ts";

/** One replica of a test document with its own undo manager, configured as a workspace's is. */
export type Replica = { store: Store; undo: UndoManager };

const BASE_PEER = 90n;

/**
 * A document holding `nodes` (each listed by its parent unless `listed` is false), written by a peer
 * no replica uses, so every replica forks from identical history.
 */
export function base(nodes: { id: string; parent?: string; listed?: boolean }[]): Uint8Array {
  const store = new Store(Store.newDoc());
  store.doc.setPeerId(BASE_PEER);
  for (const spec of nodes) {
    const parent = spec.parent === undefined ? undefined : store.node(spec.parent as NodeId);
    const node = parent ? parent.createNode() : store.tree.createNode();
    writeCreationFacts(node, { id: spec.id as NodeId });
    if (spec.parent !== undefined) {
      if (spec.listed ?? true) {
        insertListing(store, spec.parent as NodeId, spec.id as NodeId);
      }
    }
    store.doc.commit({ origin: GENESIS });
  }
  return store.doc.export({ mode: "snapshot" });
}

export function replica(peer: bigint, snapshot: Uint8Array): Replica {
  const doc = Store.newDoc();
  doc.import(snapshot);
  doc.setPeerId(peer);
  return { store: new Store(doc), undo: new UndoManager(doc, { mergeInterval: 0, excludeOriginPrefixes: [EXCLUDED] }) };
}

/** Runs `write` as one command and commits it as one undo step. */
export function command(replica: Replica, write: (command: CommandId) => void): CommandId {
  const id = nextCommandId(replica.store.doc);
  write(id);
  replica.store.doc.commit({ origin: COMMAND });
  return id;
}

export function send(from: Replica, to: Replica): void {
  to.store.doc.import(from.store.doc.export({ mode: "update", from: to.store.doc.oplogVersion() }));
}

export function sync(a: Replica, b: Replica): void {
  send(a, b);
  send(b, a);
}

export function node(replica: Replica, id: string) {
  return replica.store.node(id as NodeId);
}
