// Purpose: Folds a node's tag applications across concurrent metanode candidates into its raw tag values.

import type { NodeId } from "../store/node-id.ts";
import { isEmpty } from "../graph/emptiness.ts";
import type { Graph } from "../graph/graph.ts";
import { ownedMetanodes } from "../graph/metanode.ts";
import { listedNodes, type Occurrence } from "../graph/occurrences.ts";
import { tupleDefinitionRead } from "../graph/presence.ts";
import { isTupleType, tupleValues } from "../graph/tuples.ts";

/** Where a raw tag value is stored: one value occurrence of one application. */
export type TagProvenance = { application: NodeId; occurrence: Occurrence };

/**
 * One raw tag value: the value node, whatever it is (a reference to a supertag, an owned plain node,
 * an empty value), with every stored occurrence that contributes it.
 */
export type TagValue = { node: NodeId; provenance: TagProvenance[] };

/**
 * The tuples carrying `metanode`'s tags. Serially there is one; concurrent first writes into one
 * metanode can leave several, read in list order.
 */
export function applications(graph: Graph, metanode: NodeId): NodeId[] {
  return listedNodes(graph, metanode).filter(
    (child) => isTupleType(graph, child) && tupleDefinitionRead(graph, child) === graph.system.tags,
  );
}

/**
 * The raw tag values of `host`, unfiltered. Serially this is its one application's values. Concurrent
 * first writes can leave several applications, across the metanodes `host` owns (smallest first) and
 * within one (list order). The first application is read as stored, even when it holds no value; each
 * later value is added as adding a tag adds it. An empty first value is replaced first, so an empty
 * value never hides another replica's tags behind the first-value gate; otherwise a reference to a
 * node already present only adds provenance, and anything else is appended.
 */
export function rawTagValues(graph: Graph, host: NodeId): TagValue[] {
  const values: TagValue[] = [];
  let seed: NodeId | undefined;
  for (const metanode of ownedMetanodes(graph, host)) {
    for (const application of applications(graph, metanode)) {
      seed ??= application;
      for (const occurrence of tupleValues(graph, application)) {
        const provenance = { application, occurrence };
        if (application === seed) {
          values.push({ node: occurrence.node, provenance: [provenance] });
        } else {
          add(graph, values, occurrence, provenance);
        }
      }
    }
  }
  return values;
}

function add(graph: Graph, values: TagValue[], occurrence: Occurrence, provenance: TagProvenance): void {
  const index = occurrence.link === "reference" ? values.findIndex((value) => value.node === occurrence.node) : -1;
  const value: TagValue =
    index === -1
      ? { node: occurrence.node, provenance: [provenance] }
      : { node: occurrence.node, provenance: [...values[index]!.provenance, provenance] };
  const first = values[0];
  if (first !== undefined && isEmpty(graph, first.node)) {
    // The value takes the empty first place; an earlier listing of the same node merges into it.
    if (index > 0) {
      values.splice(index, 1);
    }
    values[0] = value;
  } else if (index === -1) {
    values.push(value);
  } else {
    values[index] = value;
  }
}
