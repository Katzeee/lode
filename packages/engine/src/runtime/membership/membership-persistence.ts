import type { DocStore } from "../../core/store/doc-store.js";

/**
 * Persists the membership log's snapshot to the per-workspace store (design
 * sync-identity-persistence §9). The membership doc is a PUBLIC signed roster (the transit keys
 * inside it are per-member wrapped, so the doc itself isn't secret) and is small + rarely-changing
 * (governance events only), so it persists as ONE deep snapshot — overwritten each save. No
 * incremental updates, no shallow snapshots: governance history accumulates in the append-only log
 * and a deep snapshot carries it.
 *
 * Engine-owned (not daemon) so mobile — which composes the same pieces in-process with no daemon —
 * inherits load/persist by constructing this handle from its own DocStore.
 */
export type MembershipPersistence = {
  /** The persisted membership snapshot, or null if the doc has never been saved. */
  load(): Promise<Uint8Array | null>;
  /** Overwrite the persisted membership snapshot. */
  save(snapshotBytes: Uint8Array): Promise<void>;
};

/**
 * A `MembershipPersistence` backed by the core `DocStore` port — the membership snapshot persisted
 * as a content snapshot under `id` (the meta doc's id, e.g. `"membership"`). The membership doc is a
 * content sub-doc, same `id → bytes` shape as the outliner docs; there is no dedicated membership
 * table. The adapter is the only place that knows membership's persistence id is its doc id.
 */
export class DocStoreMembershipPersistence implements MembershipPersistence {
  constructor(
    private readonly docStore: DocStore,
    private readonly id: string,
  ) {}

  async load(): Promise<Uint8Array | null> {
    const bytes = await this.docStore.load(this.id);
    return bytes?.snapshot ?? null;
  }

  save(snapshotBytes: Uint8Array): Promise<void> {
    return this.docStore.writeSnapshot(this.id, snapshotBytes);
  }
}
