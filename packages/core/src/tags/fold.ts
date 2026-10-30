// Purpose: Folds a node's tag applications across concurrent metanode candidates into its raw tag values.

import type { NodeId } from "../store/node-id.ts";
import { isEmpty } from "../graph/emptiness.ts";
import type { Graph } from "../graph/graph.ts";
import { metanodeTargets } from "../graph/metanode.ts";
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

/** How the fold compares, classifies and tests the values it folds, whatever they are. */
export type FoldValues<V> = {
  same(a: V, b: V): boolean;
  isReference(value: V): boolean;
  isEmpty(value: V): boolean;
};

/**
 * Folds applications into one list of values, each with every contribution to it, first contribution
 * first. The first application is the seed, read as stored even when it holds no value; each later
 * value is added as adding a tag adds it. An empty first value is replaced first, so an empty value
 * never hides another replica's tags behind the first-value gate; otherwise a reference to a value
 * already present only adds a contribution, and anything else is appended.
 */
export function foldApplications<V>(applicationValues: readonly (readonly V[])[], values: FoldValues<V>): V[][] {
  const folded: V[][] = [];
  applicationValues.forEach((list, index) => {
    for (const value of list) {
      if (index === 0) {
        folded.push([value]);
      } else {
        add(folded, value, values);
      }
    }
  });
  return folded;
}

function add<V>(folded: V[][], value: V, values: FoldValues<V>): void {
  const index = values.isReference(value) ? folded.findIndex((group) => values.same(group[0]!, value)) : -1;
  const group = index === -1 ? [value] : [...folded[index]!, value];
  const first = folded[0];
  if (first !== undefined && values.isEmpty(first[0]!)) {
    // The value takes the empty first place; an earlier listing of the same node merges into it.
    if (index > 0) {
      folded.splice(index, 1);
    }
    folded[0] = group;
  } else if (index === -1) {
    folded.push(group);
  } else {
    folded[index] = group;
  }
}

/**
 * The raw tag values of `host`, unfiltered. Serially this is its one application's values. Concurrent
 * first writes can leave several applications, across the metanodes `host` owns (smallest first) and
 * within one (list order); they are folded together.
 */
export function rawTagValues(graph: Graph, host: NodeId): TagValue[] {
  const lists = metanodeTargets(graph, host).flatMap((metanode) =>
    applications(graph, metanode).map((application) =>
      tupleValues(graph, application).map((occurrence) => ({ application, occurrence })),
    ),
  );
  return foldApplications<TagProvenance>(lists, {
    same: (a, b) => a.occurrence.node === b.occurrence.node,
    isReference: (value) => value.occurrence.link === "reference",
    isEmpty: (value) => isEmpty(graph, value.occurrence.node),
  }).map((group) => ({ node: group[0]!.occurrence.node, provenance: group }));
}
