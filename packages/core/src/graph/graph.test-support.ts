// Purpose: Builds graph test replicas whose nodes carry support, with helpers to create and edit through commands.

import type { UndoManager } from "loro-crdt";
import { allocate, type AllocatedRelation, type Allocation } from "../store/allocate.ts";
import { nextCommandId, type CommandId } from "../store/command-id.ts";
import type { DocId } from "../store/doc-id.ts";
import type { NodeId } from "../store/node-id.ts";
import { COMMAND } from "../store/origins.ts";
import { writeSupport } from "../store/records.ts";
import { base, replica } from "../store/replicas.test-support.ts";
import type { Graph } from "./graph.ts";
import { SYSTEM_ROLES, systemNodes, type SystemRole } from "./system-nodes.ts";

export type Replica = Graph & { undo: UndoManager };

const DOC = "doc" as DocId;

/** Test ids are plain names; a system role's name, such as `trash`, names that system node. */
export const id = (name: string) =>
  ((SYSTEM_ROLES as readonly string[]).includes(name) ? systemNodes(DOC)[name as SystemRole] : name) as NodeId;

/** Replicas forked from one base holding Trash and `nodes`, each present. */
export function replicas(nodes: { name: string; parent?: string; listed?: boolean }[], peers = [1n, 2n]): Replica[] {
  const stored = [{ name: "trash" }, ...nodes] as typeof nodes;
  const snapshot = base(
    stored.map(({ name, parent, listed }) => ({ id: id(name), parent: parent && id(parent), listed })),
    { supported: true, docId: DOC },
  );
  return peers.map((peer) => ({ ...replica(peer, snapshot), system: systemNodes(DOC) }));
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
    writeSupport(r.store, spec.id, commandId);
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
