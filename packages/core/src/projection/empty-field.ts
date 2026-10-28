// Purpose: Decides when a template field shows as an empty field instead of its template value.

import { isEmpty } from "../graph/emptiness.ts";
import type { Graph } from "../graph/graph.ts";
import { storedNode, type NodeAddress } from "./address.ts";
import { childrenOf, definitionAt, isTupleAt, kindAt } from "./readers.ts";
import { isSupertagAt, templateAt } from "./tag-reads.ts";

/**
 * A template field shows as an empty field when it is a tuple, the instance is not itself a supertag,
 * its first value is not an empty tagged node, and it has no tuple children. Its children are its
 * definition endpoint and its values. The reference system also excludes formula fields and gates all
 * of this behind a flag; Lode has no formulas and keeps the flag on.
 */
export function showsAsEmptyField(graph: Graph, instance: NodeAddress, tuple: NodeAddress): boolean {
  if (!isTupleAt(graph, tuple) || isSupertagAt(graph, instance)) {
    return false;
  }
  const values = childrenOf(graph, tuple).map((line) => line.node);
  const first = values[0];
  const emptyTaggedValue =
    first !== undefined && templateAt(graph, first) !== undefined && isEmpty(graph, storedNode(first));
  const definition = definitionAt(graph, tuple);
  const children = definition === undefined ? values : [definition, ...values];
  return !emptyTaggedValue && !children.some((child) => kindAt(graph, child) === "tuple");
}
