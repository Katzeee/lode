// Purpose: Creates projected addresses within a projection context, bounded by the template root they started from.

import type { Graph } from "../graph/graph.ts";
import { isProjected, type NodeAddress, type Projected, type ProjectionMode } from "./address.ts";
import { resolveAddress } from "./resolve.ts";
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
 * The proxy factory: a shared node is returned as itself, before any resolution; anything else as its
 * projection in the context, resolved to the copy currently materialized for it, if any.
 */
export function project(graph: Graph, context: ProjectionContext, source: NodeAddress): NodeAddress {
  return !isProjected(source) && materializeAsSelf(graph, source)
    ? source
    : resolveAddress(graph, { instance: context.instance, root: context.root, source, mode: context.mode });
}
