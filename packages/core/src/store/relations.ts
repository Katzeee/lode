// Purpose: Stores metanode and association relations under command-specific keys for concurrent edits.

import type { LoroTreeNode } from "loro-crdt";
import { peerOf, type CommandId } from "./command-id.ts";
import type { NodeId } from "./node-id.ts";
import type { Store } from "./store.ts";

/**
 * A relation a host holds: its metanode pointer, or its association of `holder` with `subject`.
 * Storage retains competing records; graph readers select one effective metanode and one holder
 * per subject.
 */
export type Relation = { type: "meta"; target: NodeId } | { type: "assoc"; subject: NodeId; holder: NodeId };

export type RelationRecord = Relation & { key: string; command: CommandId };

const SEPARATOR = "|";

/**
 * Every relation record on `host`. Each is its own key, `meta|M|cmd` or `assoc|S|H|cmd`: a fresh key
 * per command means a concurrent removal, which deletes only the keys it saw, cannot delete it.
 */
export function relationRecords(host: LoroTreeNode): RelationRecord[] {
  return (host.data.keys() as string[]).flatMap((key) => parseRelationKey(key) ?? []);
}

/** The record a map key encodes, or undefined for a key that is not a relation record. */
export function parseRelationKey(key: string): RelationRecord | undefined {
  const parts = key.split(SEPARATOR);
  if (parts[0] === "meta" && parts.length === 3) {
    return { type: "meta", target: parts[1] as NodeId, key, command: parts[2] as CommandId };
  }
  if (parts[0] === "assoc" && parts.length === 4) {
    const [, subject, holder, command] = parts as [string, NodeId, NodeId, CommandId];
    return { type: "assoc", subject, holder, key, command };
  }
  return undefined;
}

export function sameRelation(a: Relation, b: Relation): boolean {
  return a.type === "meta"
    ? b.type === "meta" && a.target === b.target
    : b.type === "assoc" && a.subject === b.subject && a.holder === b.holder;
}

/**
 * Sets `relation` on `host` for `command`: deletes the records of the same relation this peer wrote
 * earlier, so sequential commands leave one key per peer, then writes the command's own key. The
 * store's derived indexes are updated at once, so reads before the commit already see the write.
 */
export function writeRelation(store: Store, host: LoroTreeNode, relation: Relation, command: CommandId): void {
  const peer = peerOf(command);
  for (const record of relationRecords(host)) {
    if (sameRelation(record, relation) && peerOf(record.command) === peer) {
      host.data.delete(record.key);
    }
  }
  host.data.set(keyOf(relation, command), true);
  store.holders.reindex(host);
}

/** Removes the records the caller observed; a record written concurrently elsewhere survives. */
export function deleteRelationRecords(store: Store, host: LoroTreeNode, observed: readonly RelationRecord[]): void {
  for (const record of observed) {
    host.data.delete(record.key);
  }
  store.holders.reindex(host);
}

function keyOf(relation: Relation, command: CommandId): string {
  const parts = relation.type === "meta" ? ["meta", relation.target] : ["assoc", relation.subject, relation.holder];
  return [...parts, command].join(SEPARATOR);
}
