// Purpose: Reads the live relation records of a host, the single definition of relation liveness.

import type { NodeId } from "../store/node-id.ts";
import { relationRecords, type RelationRecord } from "../store/relations.ts";
import type { Graph } from "./graph.ts";
import { isPresent, ownerOf } from "./presence.ts";

export type MetaRecord = RelationRecord & { type: "meta" };
export type AssocRecord = RelationRecord & { type: "assoc" };

/**
 * A record is live when its host and its target (the metanode, or the holder) are both present. A
 * relation from or to an undone creation therefore reads as cleared, without rewriting the record,
 * so Redo needs no rewrite either. This covers an undone creation of a host together with its
 * metanode, whose raw pointer the reference system keeps while both sit in Trash. A metanode pointer
 * is also live only while its host owns the metanode: Lode's policy for competing pointers left by
 * concurrent edits treats a pointer to a target owned elsewhere as cleared.
 */
export function isLive(graph: Graph, host: NodeId, record: RelationRecord): boolean {
  const target = record.type === "meta" ? record.target : record.holder;
  const owned = record.type !== "meta" || ownerOf(graph, target) === host;
  return isPresent(graph, host) && isPresent(graph, target) && owned;
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
