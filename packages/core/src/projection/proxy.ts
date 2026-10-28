// Purpose: Creates projected addresses within a projection context, bounded by the template root they started from.

import type { Graph } from "../graph/graph.ts";
import { isProjected, type NodeAddress, type Projected, type ProjectionMode } from "./address.ts";
import { materializeAsSelf } from "./sharing.ts";

export type ProjectionContext = {
  readonly instance: NodeAddress;
  readonly root: NodeAddress;
  readonly mode: ProjectionMode;
};

export function contextOf(projected: Projected): ProjectionContext {
  return { instance: projected.instance, root: projected.root, mode: projected.mode };
}

/**
 * The proxy factory: a shared node is returned as itself, anything else as its projection in the
 * context. Returning the copy already materialized for a projection is also the factory's contract;
 * it is resolved where copies exist, with materialization.
 */
export function project(graph: Graph, context: ProjectionContext, source: NodeAddress): NodeAddress {
  return !isProjected(source) && materializeAsSelf(graph, source)
    ? source
    : { instance: context.instance, root: context.root, source, mode: context.mode };
}
