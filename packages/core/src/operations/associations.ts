// Purpose: Assigns and removes association holders, keeping one holder per pair and one pair per holder.

import { effectiveHolder } from "../graph/associations.ts";
import { lists } from "../graph/occurrences.ts";
import { ownerOf } from "../graph/presence.ts";
import type { NodeId } from "../store/node-id.ts";
import { deleteRelationRecords, relationRecords, writeRelation } from "../store/relations.ts";
import { unlistFrom } from "./listing.ts";
import { moveToTrash, setOwner } from "./owner.ts";
import type { Writer } from "./writer.ts";

/**
 * Associates `holder` with (`host`, `subject`). The holder leaves Trash's listing when Trash lists it,
 * and the host becomes its owner as the owner guard allows; the host adds no listing, and every other
 * listing stays. Whether or not the owner changed, the holder's other pairs and the pair's other
 * holders lose every stored record this command observes, live or not, so a holder serves one pair
 * and a pair has one holder. Then the host is touched and the command writes its own fresh key, after
 * deleting this peer's earlier keys for the relation. Setting the current pair again re-asserts it with a fresh key
 * and support, so a concurrent removal that observed only the older key does not remove it.
 */
export function setAssociatedDataFor(writer: Writer, host: NodeId, subject: NodeId, holder: NodeId): void {
  const { graph } = writer;
  const { store, system } = graph;
  // Read before any write and whatever their liveness: a record hidden now, by an undone endpoint or by
  // this command's own owner change, would otherwise come back once the endpoint is present again.
  const otherPairs = Map.groupBy(
    store.holders.recordsOf(holder).filter((record) => record.host !== host || record.subject !== subject),
    (record) => record.host,
  );
  const otherHolders = relationRecords(store, host).filter(
    (record) => record.type === "assoc" && record.subject === subject && record.holder !== holder,
  );
  if (store.has(holder)) {
    if (lists(graph, system.trash, holder)) {
      unlistFrom(writer, holder, system.trash);
    }
    setOwner(writer, holder, host);
  }
  for (const [oldHost, records] of otherPairs) {
    deleteRelationRecords(store, oldHost, records);
  }
  deleteRelationRecords(store, host, otherHolders);
  writer.touch(host);
  writeRelation(store, host, { type: "assoc", subject, holder }, writer.command);
}

/**
 * Drops the pair's association: its effective holder goes to the top of Trash with Trash as its owner
 * when the host owns it, the host's own listing of it staying as a reference, and every record of the
 * pair with that holder this command observes is deleted, from any peer. The next live holder, if
 * concurrency left one, becomes effective.
 */
export function removeAssociatedDataFor(writer: Writer, host: NodeId, subject: NodeId): void {
  const holder = effectiveHolder(writer.graph, host, subject);
  if (holder !== undefined) {
    dissociate(writer, host, subject, holder);
  }
}

/** Dissociates one holder from the pair, as `removeAssociatedDataFor` does its effective holder. */
export function dissociate(writer: Writer, host: NodeId, subject: NodeId, holder: NodeId): void {
  const { graph } = writer;
  if (ownerOf(graph, holder) === host) {
    moveToTrash(writer, holder);
  }
  const records = relationRecords(graph.store, host).filter(
    (record) => record.type === "assoc" && record.subject === subject && record.holder === holder,
  );
  deleteRelationRecords(graph.store, host, records);
}
