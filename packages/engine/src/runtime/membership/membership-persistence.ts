import type { WorkspaceStore } from "../../persistence/workspace-store.js";
import { MEMBERSHIP_DOC_ID } from "./membership-log.js";

/** The docs-table kind for the membership doc. The content loader loads only `CONTENT_DOC_KIND`, so
 *  this non-content kind keeps the membership doc out of content loading without a magic-string skip. */
const MEMBERSHIP_DOC_KIND = "membership";

/**
 * Persists the membership log's LoroDoc snapshot to the per-workspace store (design
 * sync-identity-persistence §9). The membership doc is a PUBLIC signed roster (the transit keys
 * inside it are per-member wrapped, so the doc itself isn't secret) and is small + rarely-changing
 * (governance events only), so it persists as ONE deep snapshot row — doc_id = MEMBERSHIP_DOC_ID,
 * sub_doc = main, covered_update_seq = 0 — overwritten each save, exactly like content shards
 * (workspace-registry.persistMutation's shard loop). No incremental updates, no shallow snapshots:
 * governance history accumulates in the append-only list and a deep snapshot carries it.
 *
 * Engine-owned (not daemon) so mobile — which composes the same pieces in-process with no daemon —
 * inherits load/persist by constructing this handle from its own workspace store.
 */
export type MembershipPersistence = {
  /** The persisted membership snapshot, or null if the doc has never been saved. */
  load(): Promise<Uint8Array | null>;
  /** Overwrite the persisted membership snapshot (creates the doc row on first save). */
  save(snapshotBytes: Uint8Array): Promise<void>;
};

/**
 * A `MembershipPersistence` backed by a per-workspace `WorkspaceStore`. The membership doc is a
 * peer of content in the same sqlite file — its own doc_id, never a registered `Workspace` doc
 * (`Workspace.createDoc` is single-doc). The `created` flag routes the first save through
 * `createDoc` (which also writes the initial snapshot); later saves upsert the snapshot row.
 */
export class WorkspaceMembershipPersistence implements MembershipPersistence {
  private created = false;

  constructor(private readonly store: WorkspaceStore) {}

  async load(): Promise<Uint8Array | null> {
    const loaded = await this.store.loadDocBytes(MEMBERSHIP_DOC_ID);
    this.created = loaded !== null;
    // Membership is snapshot-only (never appendUpdate), so updateBytes is always empty here.
    return loaded?.snapshotBytes ?? null;
  }

  async save(snapshotBytes: Uint8Array): Promise<void> {
    if (!this.created) {
      await this.store.createDoc({
        docId: MEMBERSHIP_DOC_ID,
        displayName: MEMBERSHIP_DOC_ID,
        kind: MEMBERSHIP_DOC_KIND,
        snapshotBytes,
      });
      this.created = true;
      return;
    }
    await this.store.writeSnapshot({
      docId: MEMBERSHIP_DOC_ID,
      coveredUpdateSeq: 0,
      snapshotBytes,
    });
  }
}
