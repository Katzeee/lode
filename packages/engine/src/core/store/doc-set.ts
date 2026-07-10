import type { SyncableDoc } from "./syncable.js";
import { SYS_PREFIX } from "./syncable.js";
import type { MetaDoc } from "./meta-doc.js";
import type { Outliner } from "./sharded-store.js";

/** How a doc rides the sync envelope. `sealed` = under the transit key; `public` = plaintext (a
 *  joining peer reads it BEFORE it holds the transit key — the membership roster). */
export type SecurityClass = "sealed" | "public";

export type DocSetEntry = {
  readonly doc: SyncableDoc;
  readonly securityClass: SecurityClass;
};

/**
 * The unified collection of every syncable doc in one workspace: the outliner (tree + shards, all
 * sealed) plus the meta docs upper layers register (membership — public). Core owns the set so the
 * broker and sync planning read ONE source of truth instead of a composite plus ad-hoc side docs.
 *
 * The outliner is sealed (structural content — sealed to the transit key); each meta doc carries its
 * own class. Construction is cheap (wraps the outliner by reference); meta docs are registered as
 * the layers that own them come up.
 *
 * Namespace discipline: structural ids carry `SYS_PREFIX`; a meta doc registering under `sys:` is
 * rejected at registration. Beyond that the set does NOT parse ids — equality only.
 */
export class WorkspaceDocSet {
  private readonly outliner: Outliner;
  private readonly metaEntries = new Map<string, DocSetEntry>();

  constructor(outliner: Outliner) {
    this.outliner = outliner;
  }

  /** Register a meta doc with its security class. Rejects a `sys:`-prefixed id (core-reserved) and a
   *  duplicate. The outliner is NOT registerable here — it owns the sealed structural ids. */
  registerMeta(doc: MetaDoc, securityClass: SecurityClass): void {
    if (doc.id.startsWith(SYS_PREFIX)) {
      throw new Error(
        `WorkspaceDocSet: meta id "${doc.id}" collides with the reserved ${SYS_PREFIX} namespace`,
      );
    }
    if (this.metaEntries.has(doc.id)) {
      throw new Error(`WorkspaceDocSet: meta doc already registered: ${doc.id}`);
    }
    this.metaEntries.set(doc.id, { doc, securityClass });
  }

  /** The entry for `id`, or undefined if unknown. Meta entries (cheap Map lookup) are checked before
   *  the outliner so the frequent public-doc path doesn't force shard materialization. The outliner
   *  is sealed by definition; a meta doc carries its registered class. */
  entry(id: string): DocSetEntry | undefined {
    const meta = this.metaEntries.get(id);
    if (meta) {
      return meta;
    }
    for (const doc of this.outliner.docs()) {
      if (doc.id === id) {
        return { doc, securityClass: "sealed" };
      }
    }
    return undefined;
  }

  /** Every doc — outliner first (exchange order: tree, then shards), then meta docs. */
  docs(): SyncableDoc[] {
    return [...this.outliner.docs(), ...[...this.metaEntries.values()].map((entry) => entry.doc)];
  }

  /** The content composite (tree + shards) — the sealed docs the SyncExchange exchanges. Distinct
   *  from `docs()` so the broker's profile stays composite-only (a meta doc rides push, not req/resp). */
  composite(): Outliner {
    return this.outliner;
  }
}
