// Purpose: Selects the tags a node shows as badges from its raw tag values.

import type { NodeId } from "../store/node-id.ts";
import { hasName } from "../graph/content.ts";
import type { Graph } from "../graph/graph.ts";
import { isSystemNode } from "../graph/system-nodes.ts";
import { isSupertag } from "./roles.ts";
import { templates } from "./templates.ts";

/**
 * Raw values that hold the supertag role and have a name, minus system nodes (the supertag and
 * field-definition markers among them; the workspace containers are not system nodes). The reference system also shows values not yet loaded; 0.1
 * reads a fully loaded graph, so that branch is a loading boundary, not a rule here.
 */
export function tagBadges(graph: Graph, node: NodeId): NodeId[] {
  return (templates(graph, node) ?? []).filter(
    (tag) => !isSystemNode(graph.system, tag) && isSupertag(graph, tag) && hasName(graph, tag),
  );
}
