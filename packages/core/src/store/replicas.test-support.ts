// Purpose: Builds test replicas and coordinates their command commits and update exchange.

import type { UndoManager } from "loro-crdt";
import { nextCommandId, type CommandId } from "./command-id.ts";
import type { NodeId } from "./node-id.ts";
import { COMMAND, GENESIS } from "./origins.ts";
import { writeAllocation } from "./allocate.ts";
import { writeDocId, type DocId } from "./doc-id.ts";
import { writeSupport } from "./records.ts";
import { Store } from "./store.ts";
import { newUndoManager } from "./undo.ts";

/** One replica of a test document with its own undo manager, configured as a workspace's is. */
export type Replica = { store: Store; undo: UndoManager };

const BASE_PEER = 90n;

/**
 * A document holding `nodes` (each listed by its parent unless `listed` is false), written by a peer
 * no replica uses, so every replica forks from identical history. With `supported`, each node carries
 * that peer's support, so every base node is present; `docId` names the workspace.
 */
export function base(
  nodes: { id: string; parent?: string; listed?: boolean }[],
  { supported = false, docId }: { supported?: boolean; docId?: DocId } = {},
): Uint8Array {
  const store = new Store(Store.newDoc());
  store.doc.setPeerId(BASE_PEER);
  if (docId) {
    writeDocId(store.doc, docId);
  }
  const id = nextCommandId(store.doc);
  for (const spec of nodes) {
    const node = spec.id as NodeId;
    writeAllocation(store, id, [{ id: node, parent: spec.parent as NodeId | undefined, listed: spec.listed ?? true }]);
    if (supported) {
      writeSupport(store, node, id);
    }
  }
  store.doc.commit({ origin: GENESIS });
  return store.doc.export({ mode: "snapshot" });
}

export function replica(peer: bigint, snapshot: Uint8Array): Replica {
  const doc = Store.newDoc();
  doc.import(snapshot);
  doc.setPeerId(peer);
  return { store: new Store(doc), undo: newUndoManager(doc) };
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
