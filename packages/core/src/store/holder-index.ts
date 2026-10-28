// Purpose: Keeps an in-memory index from each association holder to the relation records naming it.

import type { LoroDoc, LoroTreeNode, TreeID } from "loro-crdt";
import type { NodeId } from "./node-id.ts";
import { idOf } from "./records.ts";
import { relationRecords, type RelationRecord } from "./relations.ts";
import type { Store } from "./store.ts";

/** An association record as seen from its holder: which host names the holder, for which subject. */
export type HolderRecord = RelationRecord & { type: "assoc"; host: NodeId };

/**
 * Association records live on their host, so finding the pairs a holder serves would scan every node.
 * The index is derived, never stored, and kept by one mechanism: re-reading a host's records. Relation
 * writes re-read their host at once, so reads inside an uncommitted command already agree in both
 * directions; map events re-read the hosts that imports, undo and redo change. A record key is unique
 * only within its host's map, so entries are kept per host.
 */
export class HolderIndex {
  readonly #byHolder = new Map<NodeId, Map<NodeId, HolderRecord[]>>();
  readonly #holdersByHost = new Map<NodeId, Set<NodeId>>();

  constructor(store: Store, doc: LoroDoc) {
    for (const node of store.tree.getNodes()) {
      this.reindex(node);
    }
    doc.subscribe((batch) => {
      for (const event of batch.events) {
        const treeId = event.path[1];
        if (event.diff.type === "map" && event.path[0] === "nodes" && typeof treeId === "string") {
          const host = store.tree.getNodeByID(treeId as TreeID);
          if (host) {
            this.reindex(host);
          }
        }
      }
    });
  }

  /** Every stored record naming `holder`, live or not. */
  recordsOf(holder: NodeId): HolderRecord[] {
    return [...(this.#byHolder.get(holder)?.values() ?? [])].flat();
  }

  /** Replaces the index entries of `host` with the records its map holds now. */
  reindex(host: LoroTreeNode): void {
    const hostId = idOf(host);
    if (hostId === undefined) {
      return;
    }
    for (const holder of this.#holdersByHost.get(hostId) ?? []) {
      this.#byHolder.get(holder)?.delete(hostId);
    }
    const holders = new Set<NodeId>();
    for (const record of relationRecords(host)) {
      if (record.type !== "assoc") {
        continue;
      }
      let byHost = this.#byHolder.get(record.holder);
      if (!byHost) {
        byHost = new Map();
        this.#byHolder.set(record.holder, byHost);
      }
      const records = byHost.get(hostId) ?? [];
      records.push({ ...record, host: hostId });
      byHost.set(hostId, records);
      holders.add(record.holder);
    }
    this.#holdersByHost.set(hostId, holders);
  }
}
