// Purpose: Reads a node's effective name, the one input of every name read, and opens its text for writing.

import type { Delta, LoroText } from "loro-crdt";
import type { NodeId } from "../store/node-id.ts";
import { COMMAND, NAME_SEED } from "../store/origins.ts";
import { isNameSeeded, nameBaseOf, writeNameSeeded } from "../store/records.ts";
import { nameLength, nameText } from "../store/text.ts";
import type { Graph } from "./graph.ts";
import { isPresent } from "./presence.ts";

/**
 * The name every reader sees, as text runs with their marks. A node that is not present reads with no
 * name: serially no live command's text remains on it, since every text write also writes support and
 * undoing that command undoes both. A derived copy is created with its copied name as `nameBase`,
 * because replicas that create it concurrently would each insert the name into one shared text and
 * double it; it reads `nameBase` until its text is first written. Reading never writes.
 */
export function nameOf(graph: Graph, id: NodeId): Delta<string>[] {
  if (!isPresent(graph, id)) {
    return [];
  }
  const base = nameBaseOf(graph.store, id);
  return base !== undefined && !isNameSeeded(graph.store, id) ? base : nameText(graph.store, id).toDelta();
}

/** Any character counts, an inline anchor included; a node missing from this document has none. */
export function hasName(graph: Graph, id: NodeId): boolean {
  return nameLength(nameOf(graph, id)) > 0;
}

/** The name as plain text, inline anchors included. */
export function nameString(graph: Graph, id: NodeId): string {
  return nameOf(graph, id)
    .map((delta) => (typeof delta.insert === "string" ? delta.insert : ""))
    .join("");
}

/**
 * The name text, ready for an edit: a copy's first edit seeds it from `nameBase` and marks it seeded,
 * in a commit the undo manager skips, so undoing that edit returns the name to its base rather than
 * to nothing. The command's writes so far are committed under its own origin first, which keeps them
 * in its undo step. Two replicas making the first edit of one copy concurrently both seed it, and the
 * base text appears twice (Lode's policy for a state only concurrency reaches).
 */
export function writableName(graph: Graph, id: NodeId): LoroText {
  const { store } = graph;
  const text = nameText(store, id);
  const base = nameBaseOf(store, id);
  if (base !== undefined && !isNameSeeded(store, id)) {
    if (store.doc.getPendingTxnLength() > 0) {
      store.doc.commit({ origin: COMMAND });
    }
    text.applyDelta(base);
    writeNameSeeded(store, id);
    store.doc.commit({ origin: NAME_SEED });
  }
  return text;
}
