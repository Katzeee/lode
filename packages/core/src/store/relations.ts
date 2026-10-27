// Purpose: Stores metanode and association relations under command-specific keys for concurrent edits.

import type { LoroTreeNode } from "loro-crdt";
import { peerOf, type CommandId } from "./command-id.ts";
import type { NodeId } from "./node-id.ts";

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
  const records: RelationRecord[] = [];
  for (const key of host.data.keys() as string[]) {
    const parts = key.split(SEPARATOR);
    if (parts[0] === "meta" && parts.length === 3) {
      records.push({ type: "meta", target: parts[1] as NodeId, key, command: parts[2] as CommandId });
    } else if (parts[0] === "assoc" && parts.length === 4) {
      const [, subject, holder, command] = parts as [string, NodeId, NodeId, CommandId];
      records.push({ type: "assoc", subject, holder, key, command });
    }
  }
  return records;
}

export function sameRelation(a: Relation, b: Relation): boolean {
  return a.type === "meta"
    ? b.type === "meta" && a.target === b.target
    : b.type === "assoc" && a.subject === b.subject && a.holder === b.holder;
}

/**
 * Sets `relation` on `host` for `command`: deletes the records of the same relation this peer wrote
 * earlier, so sequential commands leave one key per peer, then writes the command's own key.
 */
export function writeRelation(host: LoroTreeNode, relation: Relation, command: CommandId): void {
  const peer = peerOf(command);
  for (const record of relationRecords(host)) {
    if (sameRelation(record, relation) && peerOf(record.command) === peer) {
      host.data.delete(record.key);
    }
  }
  host.data.set(keyOf(relation, command), true);
}

/** Removes the records the caller observed; a record written concurrently elsewhere survives. */
export function deleteRelationRecords(host: LoroTreeNode, observed: readonly RelationRecord[]): void {
  for (const record of observed) {
    host.data.delete(record.key);
  }
}

function keyOf(relation: Relation, command: CommandId): string {
  const parts = relation.type === "meta" ? ["meta", relation.target] : ["assoc", relation.subject, relation.holder];
  return [...parts, command].join(SEPARATOR);
}
