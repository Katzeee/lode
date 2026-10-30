// Purpose: Builds graph test replicas whose nodes carry support, with helpers to create and edit through commands.

import { UndoManager, type LoroTreeNode } from "loro-crdt";
import { allocate, type AllocatedRelation, type Allocation } from "../store/allocate.ts";
import { nextCommandId, type CommandId } from "../store/command-id.ts";
import { writeDocId, type DocId } from "../store/doc-id.ts";
import type { NodeId } from "../store/node-id.ts";
import { COMMAND, EXCLUDED, GENESIS } from "../store/origins.ts";
import { insertListing } from "../store/listings.ts";
import { writeCreationFacts, writeSupport } from "../store/records.ts";
import { Store } from "../store/store.ts";
import type { Graph } from "./graph.ts";
import { SYSTEM_ROLES, systemNodes, type SystemRole } from "./system-nodes.ts";

export type Replica = Graph & { undo: UndoManager };

const DOC = "doc" as DocId;
const BASE_PEER = 90n;

/** Test ids are plain names; a system role's name, such as `trash`, names that system node. */
export const id = (name: string) =>
  ((SYSTEM_ROLES as readonly string[]).includes(name) ? systemNodes(DOC)[name as SystemRole] : name) as NodeId;

/**
 * Replicas forked from one base holding Trash and `nodes`, each supported by a peer no replica uses,
 * so every base node is present.
 */
export function replicas(nodes: { name: string; parent?: string; listed?: boolean }[], peers = [1n, 2n]): Replica[] {
  const base = new Store(Store.newDoc());
  base.doc.setPeerId(BASE_PEER);
  writeDocId(base.doc, DOC);
  const command = nextCommandId(base.doc);
  const written = new Map<string, LoroTreeNode>();
  for (const spec of [{ name: "trash" }, ...nodes] as typeof nodes) {
    const parent = spec.parent === undefined ? undefined : written.get(spec.parent);
    const node = parent ? parent.createNode() : base.tree.createNode();
    writeCreationFacts(node, { id: id(spec.name) });
    if (spec.parent !== undefined) {
      if (spec.listed ?? true) {
        insertListing(base, id(spec.parent), id(spec.name));
      }
    }
    writeSupport(node, command);
    written.set(spec.name, node);
  }
  base.doc.commit({ origin: GENESIS });
  const snapshot = base.doc.export({ mode: "snapshot" });
  return peers.map((peer) => {
    const doc = Store.newDoc();
    doc.import(snapshot);
    doc.setPeerId(peer);
    const undo = new UndoManager(doc, { mergeInterval: 0, excludeOriginPrefixes: [EXCLUDED] });
    return { store: new Store(doc), system: systemNodes(DOC), undo };
  });
}

/**
 * One command: allocates `nodes` with `relations` toward them, then supports them and runs `write`, as
 * one undo step.
 */
export function command(
  r: Replica,
  nodes: Allocation[],
  write: (command: CommandId) => void = () => {},
  relations: AllocatedRelation[] = [],
): CommandId {
  const commandId = nextCommandId(r.store.doc);
  if (nodes.length > 0) {
    allocate(r.store, commandId, nodes, relations);
  }
  for (const spec of nodes) {
    writeSupport(r.store.node(spec.id), commandId);
  }
  write(commandId);
  r.store.doc.commit({ origin: COMMAND });
  return commandId;
}

/** A child allocation listed by its parent. */
export const child = (name: string, parent: string, extra: Partial<Allocation> = {}): Allocation => ({
  id: id(name),
  parent: id(parent),
  listed: true,
  ...extra,
});

export function sync(a: Replica, b: Replica): void {
  b.store.doc.import(a.store.doc.export({ mode: "update", from: b.store.doc.oplogVersion() }));
  a.store.doc.import(b.store.doc.export({ mode: "update", from: a.store.doc.oplogVersion() }));
}

export function node(r: Replica, name: string) {
  return r.store.node(id(name));
}
