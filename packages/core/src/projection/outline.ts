// Purpose: Reads the lines an outline shows under a node: its template children when the content gate is open, then its own children.

import type { Graph } from "../graph/graph.ts";
import { addressKey, isProjected, sameAddress, type NodeAddress } from "./address.ts";
import { mergedList, type MergedEntry } from "./merged.ts";
import { childrenOf, ownerAt, type Line } from "./readers.ts";
import { hasValidTemplateAt, templateSourcesAt } from "./tag-reads.ts";

/** An outline line, with the template child it stands for when it comes from the merged list. */
export type OutlineLine = Line & { template?: NodeAddress };

/**
 * Template children first, then the node's own children not already shown among them. Without a valid
 * first tag, only the node's own children. A copy whose template child was removed stays among the own
 * children.
 */
export function outlineLines(graph: Graph, node: NodeAddress): OutlineLine[] {
  const own = childrenOf(graph, node);
  if (!hasValidTemplateAt(graph, node)) {
    return own;
  }
  const merged = mergedList(graph, node, { kind: "outline" });
  const shown = new Set(merged.map((entry) => addressKey(entry.node)));
  return [
    ...merged.map((entry) => mergedLine(graph, node, own, entry)),
    ...own.filter((line) => !shown.has(addressKey(line.node))),
  ];
}

function mergedLine(graph: Graph, parent: NodeAddress, own: readonly Line[], entry: MergedEntry): OutlineLine {
  const local = own.find((line) => sameAddress(line.node, entry.node));
  const link = local?.link ?? linkUnder(graph, entry.node, parent);
  return { parent, node: entry.node, link, template: entry.template };
}

/**
 * Whether a node the parent does not list reads as an original or a reference under it. Owned by the
 * parent: original. A projection: original only in its own instance. A real node from a template:
 * original when one of the parent's templates owns it, reference when one only lists it.
 */
function linkUnder(graph: Graph, node: NodeAddress, parent: NodeAddress): Line["link"] {
  if (sameAddress(ownerAt(graph, node), parent)) {
    return "original";
  }
  if (isProjected(node)) {
    return sameAddress(node.instance, parent) ? "original" : "reference";
  }
  for (const source of templateSourcesAt(graph, parent, "outline")) {
    if (sameAddress(ownerAt(graph, node), source)) {
      return "original";
    }
    if (childrenOf(graph, source).some((line) => sameAddress(line.node, node))) {
      return "reference";
    }
  }
  return "original";
}
