// Purpose: Reads a node's templates and first template, the inputs of every role and content read.

import type { NodeId } from "../store/node-id.ts";
import type { Graph } from "../graph/graph.ts";
import { hasMetanode, isMetanode } from "../graph/metanode.ts";
import { rawTagValues } from "./fold.ts";

/**
 * The node's templates; undefined when it has none. A metanode's template is the metanode template
 * system node, whatever it stores; any other node reads its raw tag values, unfiltered.
 */
export function templates(graph: Graph, node: NodeId): NodeId[] | undefined {
  if (isMetanode(graph, node)) {
    return [graph.system.metaTemplate];
  }
  if (!hasMetanode(graph, node)) {
    return undefined;
  }
  const values = rawTagValues(graph, node).map((value) => value.node);
  return values.length > 0 ? values : undefined;
}

/** The first template: the only one the field-definition role and the content gate look at. */
export function template(graph: Graph, node: NodeId): NodeId | undefined {
  return templates(graph, node)?.[0];
}
