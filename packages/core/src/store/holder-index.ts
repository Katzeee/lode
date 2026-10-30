// Purpose: Keeps an in-memory index from each association holder to the relation records naming it.

import type { LoroDoc } from "loro-crdt";
import type { NodeId } from "./node-id.ts";
import { relationRecords, type RelationRecord } from "./relations.ts";
import type { Store } from "./store.ts";

/** An association record as seen from its holder: which host names the holder, for which subject. */
export type HolderRecord = RelationRecord & { type: "assoc"; host: NodeId };

const FACTS = "node:";

/**
 * Association records live in their host's facts map, so finding the pairs a holder serves would scan
 * every node. The index is derived, never stored, and kept by one mechanism: re-reading a host's
 * records. Relation writes re-read their host at once, so reads inside an uncommitted command already
 * agree in both directions; events on the root map `node:<host>` re-read the hosts that imports, undo
 * and redo change. A record key is unique only within its host's map, so entries are kept per host.
 */
export class HolderIndex {
  readonly #store: Store;
  readonly #byHolder = new Map<NodeId, Map<NodeId, HolderRecord[]>>();
  readonly #holdersByHost = new Map<NodeId, Set<NodeId>>();

  constructor(store: Store, doc: LoroDoc) {
    this.#store = store;
    for (const host of store.ownership.ids()) {
      this.reindex(host);
    }
    doc.subscribe((batch) => {
      for (const event of batch.events) {
        const container = event.path[0];
        if (event.diff.type === "map" && event.path.length === 1 && typeof container === "string") {
          if (container.startsWith(FACTS)) {
            this.reindex(container.slice(FACTS.length) as NodeId);
          }
        }
      }
    });
  }

  /** Every stored record naming `holder`, live or not. */
  recordsOf(holder: NodeId): HolderRecord[] {
    return [...(this.#byHolder.get(holder)?.values() ?? [])].flat();
  }

  /** Replaces the index entries of `host` with the records its facts map holds now. */
  reindex(host: NodeId): void {
    for (const holder of this.#holdersByHost.get(host) ?? []) {
      this.#byHolder.get(holder)?.delete(host);
    }
    const holders = new Set<NodeId>();
    for (const record of relationRecords(this.#store, host)) {
      if (record.type !== "assoc") {
        continue;
      }
      let byHost = this.#byHolder.get(record.holder);
      if (!byHost) {
        byHost = new Map();
        this.#byHolder.set(record.holder, byHost);
      }
      const records = byHost.get(host) ?? [];
      records.push({ ...record, host });
      byHost.set(host, records);
      holders.add(record.holder);
    }
    this.#holdersByHost.set(host, holders);
  }
}
