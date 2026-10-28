// Purpose: Reads association holders at any address, each reader yielding what the projection shows.

import { associatedSubjects, effectiveHolder, effectivePair } from "../graph/associations.ts";
import type { Graph } from "../graph/graph.ts";
import { isProjected, type NodeAddress } from "./address.ts";
import { contextOf, project } from "./proxy.ts";
import { throughBoundary } from "./readers.ts";

/**
 * Direct lookup of the holder for one subject. On a projected host a projected subject is read as its
 * source, and the source's holder is projected with no boundary test.
 */
export function holderAt(graph: Graph, host: NodeAddress, subject: NodeAddress): NodeAddress | undefined {
  if (!isProjected(host)) {
    return isProjected(subject) ? undefined : effectiveHolder(graph, host, subject);
  }
  const holder = holderAt(graph, host.source, isProjected(subject) ? subject.source : subject);
  return holder === undefined ? undefined : project(graph, contextOf(host), holder);
}

/**
 * Enumeration of a host's holders, which materialization follows. On a projected host a holder inside
 * the boundary is projected and any other is the source's holder as it is.
 */
export function holdersAt(graph: Graph, host: NodeAddress): NodeAddress[] {
  if (!isProjected(host)) {
    return associatedSubjects(graph, host).flatMap((subject) => effectiveHolder(graph, host, subject) ?? []);
  }
  const context = contextOf(host);
  return holdersAt(graph, host.source).map((holder) => throughBoundary(graph, context, holder));
}

/**
 * The subject a holder serves. A projected holder's subject is mapped by the boundary; a real holder
 * keeps its real subject, even when that subject has a copy elsewhere.
 */
export function associatedSubjectAt(graph: Graph, holder: NodeAddress): NodeAddress | undefined {
  if (!isProjected(holder)) {
    return effectivePair(graph, holder)?.subject;
  }
  const subject = associatedSubjectAt(graph, holder.source);
  return subject === undefined ? undefined : throughBoundary(graph, contextOf(holder), subject);
}
