// Purpose: Reads a node's name content as the predicates that test for a name see it.

import type { NodeId } from "../store/node-id.ts";
import type { Graph } from "./graph.ts";

/** Any character counts, an inline anchor included; a node missing from this document has none. */
export function hasName(graph: Graph, id: NodeId): boolean {
  const node = graph.store.find(id);
  return node !== undefined && graph.store.name(id).length > 0;
}
