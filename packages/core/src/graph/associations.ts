// Purpose: Reads associations: each holder's effective pair, each pair's effective holder, and the unadopted rest.

import type { HolderRecord } from "../store/holder-index.ts";
import type { NodeId } from "../store/node-id.ts";
import type { Graph } from "./graph.ts";
import { compareIds, isLive, liveAssocRecords, type AssocRecord } from "./relations.ts";

/** A (host, subject) pair: the host's association for one subject. */
export type Pair = { host: NodeId; subject: NodeId };

/**
 * Serially a holder serves one pair and a pair has one holder. Concurrency can leave several live
 * records; reads pick deterministically, every record stays stored, and storage is never rewritten
 * to converge them.
 */
export function effectivePair(graph: Graph, holder: NodeId): Pair | undefined {
  const pairs = liveHolderRecords(graph, holder)
    .map(({ host, subject }) => ({ host, subject }))
    .sort(comparePairs);
  return pairs[0];
}

/**
 * The smallest live holder whose effective pair is this pair. When it loses its record, the next
 * holder becomes effective.
 */
export function effectiveHolder(graph: Graph, host: NodeId, subject: NodeId): NodeId | undefined {
  return candidateHolders(graph, host, subject).find((holder) => {
    const pair = effectivePair(graph, holder);
    return pair?.host === host && pair.subject === subject;
  });
}

/** Live holders of the pair, smallest first, whether or not the pair is their effective one. */
export function candidateHolders(graph: Graph, host: NodeId, subject: NodeId): NodeId[] {
  const holders = liveAssocRecords(graph, host)
    .filter((record) => record.subject === subject)
    .map((record) => record.holder);
  return [...new Set(holders)].sort(compareIds);
}

/** Live records of the pair that do not decide its effective holder; kept and addressable. */
export function unadoptedRecords(graph: Graph, host: NodeId, subject: NodeId): AssocRecord[] {
  const holder = effectiveHolder(graph, host, subject);
  return liveAssocRecords(graph, host).filter((record) => record.subject === subject && record.holder !== holder);
}

/** Every live record naming `holder`, from any host. */
export function liveHolderRecords(graph: Graph, holder: NodeId): HolderRecord[] {
  return graph.store.holders.recordsOf(holder).filter((record) => isLive(graph, record.host, record));
}

/** Subjects `host` holds an effective association for. */
export function associatedSubjects(graph: Graph, host: NodeId): NodeId[] {
  const subjects = new Set(liveAssocRecords(graph, host).map((record) => record.subject));
  return [...subjects].filter((subject) => effectiveHolder(graph, host, subject) !== undefined).sort(compareIds);
}

function comparePairs(a: Pair, b: Pair): number {
  return compareIds(a.host, b.host) || compareIds(a.subject, b.subject);
}
