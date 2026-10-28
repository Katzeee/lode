// Purpose: Merges an instance's template children with its own children into the list an outline and initialization read.

import type { NodeId } from "../store/node-id.ts";
import { isEmpty } from "../graph/emptiness.ts";
import type { Graph } from "../graph/graph.ts";
import { addressKey, sameAddress, storedNode, type NodeAddress } from "./address.ts";
import { showsAsEmptyField } from "./empty-field.ts";
import { project } from "./proxy.ts";
import { childrenOf, definitionAt, isTupleAt, kindAt, nameKey, ownerAt, sourceAt, type Line } from "./readers.ts";
import { templateAt, templateSourcesAt } from "./tag-reads.ts";

/**
 * Which reader builds the list. The outline reader collects sources in outline order and also matches
 * by source; the initialization reader uses initialization order, has no source match, and, when
 * materializing defaults, projects fields with their template values rather than as empty fields.
 */
export type MergeReader = { kind: "outline" } | { kind: "initialization"; materializeDefaults: boolean };

/**
 * One template child as the instance shows it: the local child that fills it, the target of a
 * template reference, or its projection. Template children of a source the instance shows projected
 * are projected themselves.
 */
export type MergedEntry = { template: NodeAddress; node: NodeAddress; filledBy: "local" | "target" | "projection" };

type Collected = { node: NodeAddress; isRef: boolean };

/**
 * The template children of every source, from the last source to the first. A tuple stands for its
 * field: a field an earlier source also supplies keeps the later source's tuple at the earlier position.
 * Other children are taken once each.
 */
function collect(graph: Graph, sources: readonly NodeAddress[]): Collected[] {
  let entries: Collected[] = [];
  const seenIds = new Set<string>();
  const seenFields = new Set<string>();
  for (const source of [...sources].reverse()) {
    const batch: Collected[] = [];
    for (const { node: child } of childrenOf(graph, source)) {
      if (seenIds.has(addressKey(child))) {
        continue;
      }
      const tuple = isTupleAt(graph, child);
      const field = tuple ? fieldKey(graph, child) : undefined;
      if (field !== undefined && seenFields.has(field)) {
        const index = entries.findIndex(
          (entry) => isTupleAt(graph, entry.node) && fieldKey(graph, entry.node) === field,
        );
        if (index !== -1) {
          batch.push(...entries.splice(index, 1));
        }
        continue;
      }
      if (field !== undefined) {
        seenFields.add(field);
      } else if (!tuple) {
        seenIds.add(addressKey(child));
      }
      batch.push({ node: child, isRef: !sameAddress(ownerAt(graph, child), source) });
    }
    entries = [...batch, ...entries];
  }
  return entries;
}

/** A tuple's field, by the identity of its definition endpoint. */
function fieldKey(graph: Graph, tuple: NodeAddress): string | undefined {
  const definition = definitionAt(graph, tuple);
  return definition === undefined ? undefined : addressKey(definition);
}

/**
 * How a template child is matched: chat and visual nodes by id, a tuple by its field, anything else by
 * its name, and an unnamed tagged node by its id. Ids and plain names are compared as they are, so a
 * plain name can match an id. Undefined for a child that cannot be matched.
 */
function keyOf(graph: Graph, node: NodeAddress): string | undefined {
  const kind = kindAt(graph, node);
  let key: string | undefined =
    kind === "chat" || kind === "visual"
      ? addressKey(node)
      : isTupleAt(graph, node)
        ? fieldKey(graph, node)
        : nameKey(graph, node);
  if (!key && templateAt(graph, node) !== undefined) {
    key = addressKey(node);
  }
  return key || undefined;
}

/** Local children by source, by field and by name; for each key the first child in the list wins. */
function localMaps(graph: Graph, children: readonly Line[], reader: MergeReader) {
  const bySource = new Map<string, NodeAddress>();
  const byField = new Map<string, NodeAddress>();
  const byName = new Map<string, NodeAddress>();
  for (const { node } of children) {
    const source = sourceAt(graph, node);
    if (reader.kind === "outline" && source !== undefined && !bySource.has(addressKey(source))) {
      bySource.set(addressKey(source), node);
    }
    const tuple = isTupleAt(graph, node);
    const field = tuple ? fieldKey(graph, node) : undefined;
    if (field !== undefined && !byField.has(field)) {
      byField.set(field, node);
    }
    // A tuple is named by its field, so a name match never fills a template child with a local tuple.
    const definition = tuple ? definitionAt(graph, node) : undefined;
    const name = tuple ? (definition === undefined ? "" : nameKey(graph, definition)) : nameKey(graph, node);
    if (name !== "" && !byName.has(name)) {
      byName.set(name, node);
    }
  }
  return { bySource, byField, byName };
}

/**
 * The instance's template children, in template order, each filled by a local child, shown as its
 * reference target, or projected. A template child repeated, empty and untagged, or keyed like an
 * earlier one is skipped; the later source wins a key.
 */
export function mergedList(graph: Graph, instance: NodeAddress, reader: MergeReader): MergedEntry[] {
  const order = reader.kind === "outline" ? "outline" : "initialization";
  const collected = collect(graph, templateSourcesAt(graph, instance, order));
  const { bySource, byField, byName } = localMaps(graph, childrenOf(graph, instance), reader);
  const system = new Set<NodeId>(Object.values(graph.system));
  const seen = new Set<string>([addressKey(instance)]);
  const merged: MergedEntry[] = [];
  for (const { node, isRef } of [...collected].reverse()) {
    const tuple = isTupleAt(graph, node);
    const skippable =
      !tuple &&
      isEmpty(graph, storedNode(node)) &&
      templateAt(graph, node) === undefined &&
      kindAt(graph, node) !== "visual";
    if (skippable || seen.has(addressKey(node))) {
      continue;
    }
    const key = keyOf(graph, node);
    if (key === undefined || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const named = byName.get(key);
    const local =
      (bySource.has(addressKey(node)) && !tuple ? bySource.get(addressKey(node)) : undefined) ??
      byField.get(key) ??
      (named !== undefined && !isTupleAt(graph, named) ? named : undefined);
    if (local !== undefined) {
      merged.push({ template: node, node: local, filledBy: "local" });
    } else if (isRef && !(typeof node === "string" && system.has(node))) {
      merged.push({ template: node, node, filledBy: "target" });
    } else {
      const emptyField =
        (reader.kind === "outline" || !reader.materializeDefaults) && showsAsEmptyField(graph, instance, node);
      const context = { instance, root: node, mode: emptyField ? "emptyField" : "template" } as const;
      merged.push({ template: node, node: project(graph, context, node), filledBy: "projection" });
    }
  }
  return merged.reverse();
}
