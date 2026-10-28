// Purpose: Collects a node's template sources, its tags and their ancestors, in each entry point's order.

import type { NodeId } from "../store/node-id.ts";
import type { Graph } from "../graph/graph.ts";
import { templates } from "./templates.ts";

/*
 * Both orders recurse over templates with no role filter, skip the supertag system node, and share one
 * visited set across the whole walk, so a node reached twice contributes no ancestors the second time
 * but is still listed again. Repeats are removed by the readers that collect children.
 */

export type SourceOrder = "outline" | "initialization";

/** What a walk needs of the nodes it visits, so projected nodes can be walked with their own reads. */
export type SourceWalk<N> = {
  templatesOf(node: N): readonly N[] | undefined;
  key(node: N): string;
  isSupertagMarker(node: N): boolean;
};

/** Template sources of `node` in `order`, walked with `reads`. */
export function templateSources<N>(node: N, order: SourceOrder, reads: SourceWalk<N>): N[] {
  return walk(node, new Set(), order, reads);
}

/** The outline order: for each tag, its ancestors, then the tag. */
export function allTemplates(graph: Graph, node: NodeId): NodeId[] {
  return templateSources(node, "outline", realWalk(graph));
}

/** The initialization order: every tag's ancestors first, then the tags. */
export function allTemplatesForInitialization(graph: Graph, node: NodeId): NodeId[] {
  return templateSources(node, "initialization", realWalk(graph));
}

function realWalk(graph: Graph): SourceWalk<NodeId> {
  return {
    templatesOf: (node) => templates(graph, node),
    key: (node) => node,
    isSupertagMarker: (node) => node === graph.system.supertag,
  };
}

function walk<N>(node: N, visited: Set<string>, order: SourceOrder, reads: SourceWalk<N>): N[] {
  if (reads.isSupertagMarker(node) || visited.has(reads.key(node))) {
    return [];
  }
  visited.add(reads.key(node));
  const tags = reads.templatesOf(node) ?? [];
  // Ancestors are walked in tag order either way, so the visited set fills the same way in both orders.
  const ancestors = tags.map((tag) => walk(tag, visited, order, reads));
  const ordered =
    order === "outline" ? tags.flatMap((tag, index) => [...ancestors[index]!, tag]) : [...ancestors.flat(), ...tags];
  return ordered.filter((tag) => !reads.isSupertagMarker(tag));
}
