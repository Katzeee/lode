// Purpose: Writes one command into the document: each touched node keeps the states it depends on and gains the command's support, and created nodes are allocated where the command creates them.

import type { Graph } from "../graph/graph.ts";
import { isPresent } from "../graph/presence.ts";
import { allocate, type AllocatedRelation, type Allocation } from "../store/allocate.ts";
import { peerOf, type CommandId } from "../store/command-id.ts";
import type { NodeId } from "../store/node-id.ts";
import { COMMAND } from "../store/origins.ts";
import { readsReal, writeReal, writeSupport } from "../store/records.ts";
import { makeReal } from "./presence.ts";

/**
 * One command's writes, run immediately, so every read sees the command's earlier writes, as the
 * reference system's primitives do. `touch` precedes an actual write into a node; a caller excludes a
 * semantic no-op before touching anything, so it adds no support. `create` allocates new nodes.
 */
export type Writer = {
  readonly graph: Graph;
  readonly command: CommandId;
  touch(id: NodeId): void;
  create(nodes: readonly Allocation[], relations?: readonly AllocatedRelation[]): void;
};

/**
 * A writer for `command`; `created` collects every NodeId it allocates, in order, for the history's
 * entry. The caller commits the command's last writes.
 */
export function createWriter(graph: Graph, command: CommandId, created: NodeId[]): Writer {
  const { store } = graph;
  const peer = peerOf(command);

  /**
   * `real|<peer>` is a contribution like support: it lasts while a command depending on it is not
   * undone. The node's support keeps its whole physical owner chain present, so every owner that reads
   * real keeps doing so through this command too. The chain is read now, never through listings,
   * mentions, subjects or sources, which name a node without supporting it. Rewriting an existing key
   * is no Loro operation, so a key is written only when missing.
   */
  const keepReal = (id: NodeId) => {
    const visited = new Set<NodeId>();
    for (let node: NodeId | undefined = id; node !== undefined && !visited.has(node);) {
      visited.add(node);
      if (readsReal(store, node)) {
        writeReal(store, node, peer);
      }
      node = store.ownership.physicalOwner(node);
    }
  };

  const writer: Writer = {
    graph,
    command,
    touch(id) {
      if (!isPresent(graph, id)) {
        makeReal(graph, command, id);
      }
      keepReal(id);
      writeSupport(store, id, command);
    },
    /**
     * Touches the existing parents and hosts it changes first, so one that is not present is made real
     * before the new node's support would make it present with its creation context. Then the command's
     * writes so far are committed under its own origin and the nodes are allocated in a commit the undo
     * manager skips, so Undo keeps their creation facts; the command then supports them.
     */
    create(nodes, relations = []) {
      const own = new Set(nodes.map((node) => node.id));
      const existing = new Set<NodeId>([
        ...nodes.flatMap((node) => (node.parent === undefined || own.has(node.parent) ? [] : [node.parent])),
        ...relations.map((relation) => relation.host).filter((host) => !own.has(host)),
      ]);
      for (const id of existing) {
        writer.touch(id);
      }
      store.doc.commit({ origin: COMMAND });
      allocate(store, command, nodes, relations);
      for (const id of own) {
        created.push(id);
        writeSupport(store, id, command);
      }
    },
  };
  return writer;
}
