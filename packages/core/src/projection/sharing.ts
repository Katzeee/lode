// Purpose: Decides which template nodes projection and materialization share instead of copying.

import type { NodeId } from "../store/node-id.ts";
import type { Graph } from "../graph/graph.ts";
import { ownerOf, tupleDefinitionRead } from "../graph/presence.ts";
import { isTuple } from "../graph/tuples.ts";
import { isFieldDefinition, isSupertag } from "../tags/roles.ts";

/**
 * A shared node is shown and copied as itself: a field definition, or an option, whose owner chain is
 * exactly option → options field tuple → field definition → tuple → supertag. The third clause of the
 * reference system, a per-node never-proxy flag, has no producer in Lode and is not read.
 */
export function materializeAsSelf(graph: Graph, node: NodeId): boolean {
  if (isFieldDefinition(graph, node)) {
    return true;
  }
  const optionsTuple = ownerOf(graph, node);
  if (
    optionsTuple === undefined ||
    !isTuple(graph, optionsTuple) ||
    tupleDefinitionRead(graph, optionsTuple) !== graph.system.options
  ) {
    return false;
  }
  const definition = ownerOf(graph, optionsTuple);
  const outerTuple = definition === undefined ? undefined : ownerOf(graph, definition);
  const supertag = outerTuple === undefined ? undefined : ownerOf(graph, outerTuple);
  return (
    definition !== undefined &&
    isFieldDefinition(graph, definition) &&
    outerTuple !== undefined &&
    isTuple(graph, outerTuple) &&
    supertag !== undefined &&
    isSupertag(graph, supertag)
  );
}
