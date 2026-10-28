// Purpose: Reads tuple structure: definition endpoint, values, and the input position of a tuple with no values.

import type { NodeId } from "../store/node-id.ts";
import type { Graph } from "./graph.ts";
import { occurrences, type Occurrence } from "./occurrences.ts";
import { kindRead, tupleDefinitionRead } from "./presence.ts";

/**
 * Where a field use with no stored value takes its first value. Only concurrent deletes reach that
 * state; the position has no NodeId, reads as strictly empty, and a write to it creates a real value.
 */
export type InputPosition = { tuple: NodeId; input: true };

export type ValueSlot = Occurrence | InputPosition;

export function isInputPosition(slot: ValueSlot): slot is InputPosition {
  return "input" in slot;
}

/** The nominal level: the node's kind is tuple. */
export function isTupleType(graph: Graph, id: NodeId): boolean {
  return kindRead(graph, id) === "tuple";
}

/** Values are every listed child: the definition endpoint is stored as a pointer, not as position 0. */
export function tupleValues(graph: Graph, id: NodeId): Occurrence[] {
  return isTupleType(graph, id) ? occurrences(graph, id) : [];
}

/** The structural level: a definition endpoint and at least one value. */
export function isTuple(graph: Graph, id: NodeId): boolean {
  return isTupleType(graph, id) && tupleDefinitionRead(graph, id) !== undefined && tupleValues(graph, id).length > 0;
}

export function isTupleList(graph: Graph, id: NodeId): boolean {
  return isTuple(graph, id) && tupleValues(graph, id).length > 1;
}

/**
 * A field use's values as a reader shows them: the stored values, or one input position when
 * concurrency left none. Undefined for a node that is not a field use.
 */
export function valueSlots(graph: Graph, id: NodeId): ValueSlot[] | undefined {
  if (!isTupleType(graph, id) || tupleDefinitionRead(graph, id) === undefined) {
    return undefined;
  }
  const values = tupleValues(graph, id);
  return values.length > 0 ? values : [{ tuple: id, input: true }];
}

/** The first value slot, as the reference system's single-value accessor reads it. */
export function tupleValue(graph: Graph, id: NodeId): ValueSlot | undefined {
  return valueSlots(graph, id)?.[0];
}
