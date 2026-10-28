// Purpose: Implements the emptiness predicates, each named after the entry points that use it.

import type { NodeId } from "../store/node-id.ts";
import { descriptionOf, nameOf } from "../store/records.ts";
import { hasName } from "./content.ts";
import type { Graph } from "./graph.ts";
import { effectiveMetanode, metanodeTargets } from "./metanode.ts";
import { listedNodes } from "./occurrences.ts";
import { tupleDefinitionRead } from "./presence.ts";
import { liveAssocRecords } from "./relations.ts";
import { isInputPosition, isTuple, isTupleList, isTupleType, tupleValue, type ValueSlot } from "./tuples.ts";

/*
 * Each entry point uses its own predicate; they are kept apart rather than unified. Media and code
 * text count as content where the reference system says so, but no 0.1 node carries either. A node
 * missing from this document is never empty: nothing about it is known.
 */

/** Outline emptiness and the template-child skip; a tuple also needs a strictly empty definition. */
export function isEmpty(graph: Graph, id: NodeId): boolean {
  return isTuple(graph, id) ? tupleIsEmpty(graph, id, true) : nodeIsEmpty(graph, id);
}

/** Tag removal and initialization: a tuple is judged by its value alone. */
export function isEmptyByValue(graph: Graph, id: NodeId): boolean {
  return isTuple(graph, id) ? tupleIsEmpty(graph, id, false) : nodeIsEmpty(graph, id);
}

/** Not a tuple, and no name, children or media. The input position of a valueless tuple qualifies. */
export function isStrictlyEmpty(graph: Graph, slot: NodeId | ValueSlot): boolean {
  if (typeof slot !== "string") {
    if (isInputPosition(slot)) {
      return true;
    }
    slot = slot.node;
  }
  return exists(graph, slot) && !isTuple(graph, slot) && !hasName(graph, slot) && listedNodes(graph, slot).length === 0;
}

/**
 * A holder that may be dissociated: resolved, and no children, name or description, reference
 * fallback, nested associations, or other metadata. A live pointer whose target the holder does not
 * own leaves the holder unresolved, so it is kept; a missing pointer is resolved with no metadata.
 * Fallbacks are outside 0.1, so any listed child of the holder's metanode is other metadata.
 */
export function holderIsEmpty(graph: Graph, holder: NodeId): boolean {
  if (!exists(graph, holder)) {
    return false;
  }
  const node = graph.store.node(holder);
  const metanode = effectiveMetanode(graph, holder);
  const unresolved = metanode === undefined && metanodeTargets(graph, holder).length > 0;
  return (
    !unresolved &&
    listedNodes(graph, holder).length === 0 &&
    nameOf(node).toString().trim() === "" &&
    (descriptionOf(node)?.trim() ?? "") === "" &&
    liveAssocRecords(graph, holder).length === 0 &&
    (metanode === undefined || listedNodes(graph, metanode).length === 0)
  );
}

function tupleIsEmpty(graph: Graph, id: NodeId, checkDefinition: boolean): boolean {
  const value = tupleValue(graph, id);
  if (isTupleList(graph, id) || (value && !isInputPosition(value) && value.link === "reference")) {
    return false;
  }
  if (!value || !isStrictlyEmpty(graph, value)) {
    return false;
  }
  const definition = tupleDefinitionRead(graph, id);
  return !checkDefinition || (definition !== undefined && isStrictlyEmpty(graph, definition));
}

function nodeIsEmpty(graph: Graph, id: NodeId): boolean {
  if (!exists(graph, id) || hasName(graph, id)) {
    return false;
  }
  const children = listedNodes(graph, id);
  const hasNonTupleChildren = children.some((child) => !isTupleType(graph, child));
  const hasTupleValues = [...tupleValueMap(graph, children).values()].some((value) => hasName(graph, value));
  return !hasNonTupleChildren && !hasTupleValues;
}

/**
 * Each definition's value among structural tuple children: the first tuple in the list wins, as in the
 * reference system's tuple value map, so a later tuple of the same field never decides emptiness.
 */
function tupleValueMap(graph: Graph, children: readonly NodeId[]): Map<NodeId, NodeId> {
  const values = new Map<NodeId, NodeId>();
  for (const child of children) {
    const definition = tupleDefinitionRead(graph, child);
    const value = tupleValue(graph, child);
    if (
      isTuple(graph, child) &&
      definition !== undefined &&
      !values.has(definition) &&
      value &&
      !isInputPosition(value)
    ) {
      values.set(definition, value.node);
    }
  }
  return values;
}

function exists(graph: Graph, id: NodeId): boolean {
  return graph.store.find(id) !== undefined;
}
