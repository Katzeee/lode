// Purpose: Reads the nodes a host's name mentions inline, and those among them the host owns.

import type { NodeId } from "../store/node-id.ts";
import { inlineMentions } from "../store/text.ts";
import type { Graph } from "./graph.ts";
import { kindRead, ownerOf } from "./presence.ts";

/**
 * Mentioned targets in text order, one entry per mention, so a target mentioned twice appears twice.
 * Chat and tuple names carry no inline nodes, and a target missing from this document is skipped.
 */
export function inlineNodes(graph: Graph, host: NodeId): NodeId[] {
  const node = graph.store.find(host);
  const kind = kindRead(graph, host);
  return !node || kind === "chat" || kind === "tuple"
    ? []
    : inlineMentions(graph.store.name(host))
        .map((mention) => mention.target)
        .filter((target) => graph.store.find(target) !== undefined);
}

/** A derived set, not a category: an inline-owned node may also be listed by its host. */
export function inlineOwnedNodes(graph: Graph, host: NodeId): NodeId[] {
  return inlineNodes(graph, host).filter((target) => ownerOf(graph, target) === host);
}
