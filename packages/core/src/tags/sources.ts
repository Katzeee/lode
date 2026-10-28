// Purpose: Collects a node's template sources, its tags and their ancestors, in each entry point's order.

import type { NodeId } from "../store/node-id.ts";
import type { Graph } from "../graph/graph.ts";
import { templates } from "./templates.ts";

/*
 * Both orders recurse over raw tag values with no role filter, skip the supertag system node, and
 * share one visited set across the whole walk, so a node reached twice contributes no ancestors the
 * second time but is still listed again. Repeats are removed by the readers that collect children.
 */

/** The outline order: for each tag, its ancestors, then the tag. */
export function allTemplates(graph: Graph, node: NodeId): NodeId[] {
  return walk(graph, node, new Set(), (ancestors, tags) => tags.flatMap((tag, index) => [...ancestors[index]!, tag]));
}

/** The initialization order: every tag's ancestors first, then the tags. */
export function allTemplatesForInitialization(graph: Graph, node: NodeId): NodeId[] {
  return walk(graph, node, new Set(), (ancestors, tags) => [...ancestors.flat(), ...tags]);
}

function walk(
  graph: Graph,
  node: NodeId,
  visited: Set<NodeId>,
  order: (ancestors: NodeId[][], tags: NodeId[]) => NodeId[],
): NodeId[] {
  if (node === graph.system.supertag || visited.has(node)) {
    return [];
  }
  visited.add(node);
  const tags = templates(graph, node) ?? [];
  // Ancestors are walked in tag order either way, so the visited set fills the same way in both orders.
  const ancestors = tags.map((tag) => walk(graph, tag, visited, order));
  return order(ancestors, tags).filter((tag) => tag !== graph.system.supertag);
}
