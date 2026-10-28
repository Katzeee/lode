// Purpose: Selects the tags a node shows as badges from its raw tag values.

import type { NodeId } from "../store/node-id.ts";
import { hasName } from "../graph/content.ts";
import type { Graph } from "../graph/graph.ts";
import { isSupertag } from "./roles.ts";
import { templates } from "./templates.ts";

/**
 * Raw values that hold the supertag role and have a name, minus system nodes (the supertag and
 * field-definition markers among them). The reference system also shows values not yet loaded; 0.1
 * reads a fully loaded graph, so that branch is a loading boundary, not a rule here.
 */
export function tagBadges(graph: Graph, node: NodeId): NodeId[] {
  const system = new Set<NodeId>(Object.values(graph.system));
  return (templates(graph, node) ?? []).filter(
    (tag) => !system.has(tag) && isSupertag(graph, tag) && hasName(graph, tag),
  );
}
