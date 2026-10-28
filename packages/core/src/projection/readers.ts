// Purpose: Reads structure, content and relations at any address, projected or real, as a projection shows them.

import type { NodeId } from "../store/node-id.ts";
import { nameOf, type Kind } from "../store/records.ts";
import { runs, type Run } from "../store/text.ts";
import type { Graph } from "../graph/graph.ts";
import { inlineNodes } from "../graph/inline.ts";
import { effectiveMetanode, metanodeTargets } from "../graph/metanode.ts";
import { occurrences } from "../graph/occurrences.ts";
import { kindRead, ownerOf, sourceRead, tupleDefinitionRead } from "../graph/presence.ts";
import { isTuple } from "../graph/tuples.ts";
import { addressKey, isProjected, sameAddress, storedNode, type NodeAddress, type Projected } from "./address.ts";
import { contextOf, project, type ProjectionContext } from "./proxy.ts";

/** One child shown under a parent; its link comes from ownership, as for stored occurrences. */
export type Line = { parent: NodeAddress; node: NodeAddress; link: "original" | "reference" };

/*
 * A projected node reads through its source, which may itself be projected: every read of the source
 * is mapped through this projection's boundary, so nested contexts compose layer by layer.
 */

/**
 * The listed children of an address. A projected node lists its source's children: each inside the
 * boundary, and the system empty value, is projected in the same context; any other is the real node,
 * so an external reference stays shared while an internal one stays projected. An empty-field tuple
 * lists exactly the projected empty value.
 */
export function childrenOf(graph: Graph, address: NodeAddress): Line[] {
  if (!isProjected(address)) {
    return occurrences(graph, address).map(({ node, link }) => ({ parent: address, node, link }));
  }
  if (address.mode === "emptyField" && sameAddress(address.source, address.root)) {
    return [{ parent: address, node: { ...address, source: graph.system.emptyValue }, link: "original" }];
  }
  const context = contextOf(address);
  return childrenOf(graph, address.source).map(({ node: child }) => {
    const node =
      child === graph.system.emptyValue || inBoundary(graph, address.root, child)
        ? project(graph, context, child)
        : child;
    return { parent: address, node, link: sameAddress(ownerAt(graph, node), address) ? "original" : "reference" };
  });
}

/**
 * A projected node's owner is the projection of its source's owner, or the instance for the root;
 * the empty value of an empty-field tuple is owned by that tuple.
 */
export function ownerAt(graph: Graph, address: NodeAddress): NodeAddress | undefined {
  if (!isProjected(address)) {
    return ownerOf(graph, address);
  }
  if (sameAddress(address.source, address.root)) {
    return address.instance;
  }
  if (address.mode === "emptyField" && address.source === graph.system.emptyValue) {
    return { ...address, source: address.root };
  }
  const owner = ownerAt(graph, address.source);
  return owner === undefined ? undefined : project(graph, contextOf(address), owner);
}

/** The root itself, or a node the root owns, directly or through its owned descendants. */
export function inBoundary(graph: Graph, root: NodeAddress, node: NodeAddress): boolean {
  const seen = new Set<string>();
  for (let current: NodeAddress | undefined = node; current !== undefined; current = ownerAt(graph, current)) {
    const key = addressKey(current);
    if (key === addressKey(root)) {
      return true;
    }
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
  }
  return false;
}

/** Inside the boundary a related node is projected in the same context; outside it is the real node. */
export function throughBoundary(graph: Graph, context: ProjectionContext, node: NodeAddress): NodeAddress {
  return inBoundary(graph, context.root, node) ? project(graph, context, node) : node;
}

/** A projected node's source is the node it shows, itself possibly projected. */
export function sourceAt(graph: Graph, address: NodeAddress): NodeAddress | undefined {
  return isProjected(address) ? address.source : sourceRead(graph, address);
}

export function kindAt(graph: Graph, address: NodeAddress): Kind | undefined {
  return kindRead(graph, storedNode(address));
}

/**
 * A tuple's definition endpoint. A projected tuple reads its source's endpoint through the boundary: a
 * field definition is shared, any other endpoint inside the boundary is projected.
 */
export function definitionAt(graph: Graph, address: NodeAddress): NodeAddress | undefined {
  if (!isProjected(address)) {
    return tupleDefinitionRead(graph, address);
  }
  const definition = definitionAt(graph, address.source);
  return definition === undefined ? undefined : throughBoundary(graph, contextOf(address), definition);
}

/** The structural tuple test, over the values the address lists. */
export function isTupleAt(graph: Graph, address: NodeAddress): boolean {
  return !isProjected(address)
    ? isTuple(graph, address)
    : kindAt(graph, address) === "tuple" &&
        definitionAt(graph, address) !== undefined &&
        childrenOf(graph, address).length > 0;
}

/** Inline targets, one per mention; a projected name's targets inside the boundary are projected. */
export function inlineAt(graph: Graph, address: NodeAddress): NodeAddress[] {
  if (!isProjected(address)) {
    return inlineNodes(graph, address);
  }
  const context = contextOf(address);
  return inlineAt(graph, address.source).map((target) => throughBoundary(graph, context, target));
}

/**
 * The name as matching compares it, as the reference system's name markup reads: literal text is
 * escaped and marks are spelled out as tags, so formatting never equals literal text that looks like
 * it, while a plain name without special characters still equals an id holding the same text. A
 * projected name's inline targets read as their projections. Empty for a node with no name.
 */
export function nameKey(graph: Graph, address: NodeAddress): string {
  const node = graph.store.find(storedNode(address));
  const named = node === undefined ? [] : runs(nameOf(node));
  return named.map((run) => markup(run, (target) => addressKey(mapTarget(graph, address, target)))).join("");
}

function markup(run: Run, target: (id: NodeId) => string): string {
  // Adjacent anchors with one target or date read as one run; each anchor is its own position.
  if (run.ref !== undefined) {
    return `<ref ${escape(target(run.ref))}/>`.repeat(run.text.length);
  }
  if (run.date !== undefined) {
    return `<date ${escape(run.date)}/>`.repeat(run.text.length);
  }
  const marks = Object.entries(run)
    .filter(([key]) => key !== "text")
    .map(([key, value]) => (value === true ? key : `${key}=${escape(String(value))}`))
    .sort();
  const text = escape(run.text);
  return marks.length === 0 ? text : `<${marks.join(" ")}>${text}</>`;
}

function escape(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** A stored inline target as a projected node reads it: mapped through each layer's boundary. */
function mapTarget(graph: Graph, address: NodeAddress, target: NodeId): NodeAddress {
  return isProjected(address)
    ? throughBoundary(graph, contextOf(address), mapTarget(graph, address.source, target))
    : target;
}

/**
 * The metanode the address points at. A real node's is its effective metanode, which it owns. A
 * projected node's metanode is its source's pointer target, projected with no boundary or ownership
 * test, so a pointer to a metanode another node owns still reads.
 */
export function metanodeAt(graph: Graph, address: NodeAddress): NodeAddress | undefined {
  return isProjected(address) ? metanodePointerAt(graph, address) : effectiveMetanode(graph, address);
}

function metanodePointerAt(graph: Graph, address: NodeAddress): NodeAddress | undefined {
  return metanodeCandidatesAt(graph, address)[0];
}

/**
 * Every live metanode target, smallest first, as the address reads them: a projected node's are its
 * source's, each projected. Plural tag reads fold all of them; a single-target read takes the first.
 */
export function metanodeCandidatesAt(graph: Graph, address: NodeAddress): NodeAddress[] {
  if (!isProjected(address)) {
    return metanodeTargets(graph, address);
  }
  const context = contextOf(address);
  return metanodeCandidatesAt(graph, address.source).map((target) => project(graph, context, target));
}

/** A projected node is a metanode when one of its owner's live pointers names it. */
export function isMetanodeAt(graph: Graph, address: Projected): boolean {
  const owner = ownerAt(graph, address);
  return owner !== undefined && metanodeCandidatesAt(graph, owner).some((target) => sameAddress(target, address));
}
