// Purpose: Reads the nodes a host's name mentions inline, and those among them the host owns.

import type { NodeId } from "../store/node-id.ts";
import { inlineMentions } from "../store/text.ts";
import { nameOf } from "./content.ts";
import type { Graph } from "./graph.ts";
import { kindRead, ownerOf } from "./presence.ts";

/**
 * Mentioned targets in text order, one entry per mention, so a target mentioned twice appears twice.
 * Chat and tuple names carry no inline nodes, and a target missing from this document is skipped.
 */
export function inlineNodes(graph: Graph, host: NodeId): NodeId[] {
  const kind = kindRead(graph, host);
  return kind === "chat" || kind === "tuple"
    ? []
    : inlineMentions(nameOf(graph, host))
        .map((mention) => mention.target)
        .filter((target) => graph.store.has(target));
}

/** A derived set, not a category: an inline-owned node may also be listed by its host. */
export function inlineOwnedNodes(graph: Graph, host: NodeId): NodeId[] {
  return inlineNodes(graph, host).filter((target) => ownerOf(graph, target) === host);
}
