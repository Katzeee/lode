// Purpose: Reads the live relation records of a host, the single definition of relation liveness.

import type { NodeId } from "../store/node-id.ts";
import { relationRecords, type RelationRecord } from "../store/relations.ts";
import type { Graph } from "./graph.ts";
import { isPresent } from "./presence.ts";

export type MetaRecord = RelationRecord & { type: "meta" };
export type AssocRecord = RelationRecord & { type: "assoc" };

/**
 * A record is live when its host and its target (the metanode, or the holder) are both present. A
 * relation from or to an undone creation therefore reads as cleared, without rewriting the record,
 * so Redo needs no rewrite either.
 */
export function isLive(graph: Graph, host: NodeId, record: RelationRecord): boolean {
  return isPresent(graph, host) && isPresent(graph, record.type === "meta" ? record.target : record.holder);
}

export function liveRecords(graph: Graph, host: NodeId): RelationRecord[] {
  const node = graph.store.find(host);
  return node ? relationRecords(node).filter((record) => isLive(graph, host, record)) : [];
}

export function liveMetaRecords(graph: Graph, host: NodeId): MetaRecord[] {
  return liveRecords(graph, host).filter((record): record is MetaRecord => record.type === "meta");
}

export function liveAssocRecords(graph: Graph, host: NodeId): AssocRecord[] {
  return liveRecords(graph, host).filter((record): record is AssocRecord => record.type === "assoc");
}

/** The deterministic order every candidate choice uses, so replicas agree without coordination. */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
