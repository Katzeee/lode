/**
 * The opaque sync + persistence contract. This is the boundary where CRDT internals are closed
 * behind impl-agnostic bytes: persistence stores `(id → bytes)`, sync carries `(version, diff)`,
 * and NEITHER parses them. The CRDT backend (loro-crdt today) lives only in the implementing
 * modules (`sharded-store.ts`, `meta-doc.ts`) — nothing above this file imports it.
 *
 * The contract a `SyncableDoc` backend MUST honor (the shape that makes a CRDT swappable here):
 *   - a CAUSAL version (`version()`) with a total-ish ordering usable for incremental diffing;
 *   - an INCREMENTAL export (`exportUpdate(from)`) of ops beyond `from`;
 *   - an IDEMPOTENT, associative merge (`importUpdate` — re-applying the same bytes is a no-op).
 * OT / centralized models do not fit this shape; that constraint is intentional.
 *
 * `SyncBytes` is `Uint8Array` aliased to mark "opaque version/snapshot bytes — do not decode."
 */

/** Opaque byte blob: a version, a snapshot, or an incremental update. Never decoded above core. */
export type SyncBytes = Uint8Array;

/** Reserved prefix on core-owned structural doc ids (`sys:tree`, `sys:s{k}`). Meta docs may NOT use
 *  it — `WorkspaceDocSet.registerMeta` rejects any id in this namespace, so a structure/domain id
 *  collision goes from "averted by luck" to "impossible by construction." The prefix serves
 *  anti-collision + debug traceability; ids stay opaque (matched by equality, never parsed) except
 *  in core's own residentBytes partition (the single place that strips it). Lives here (not doc-set)
 *  so `sharded-store` (which applies it to outward ids) and `doc-set` (which enforces it on meta
 *  registration) both depend on the leaf type file — no cycle. */
export const SYS_PREFIX = "sys:";

/**
 * One syncable CRDT doc — the opaque mechanism unit. Persistence keys bytes by `id`; sync matches
 * `{id, version}` across peers and exchanges incremental updates per id. Each implementation wraps
 * a real CRDT doc (loro `LoroDoc`) and is the only place that touches it.
 *
 * The `id` is a stable wire channel name scoped to its composite (e.g. the outliner's tree channel
 * or a shard id). It must match across replicas of the same doc.
 */
export type SyncableDoc = {
  readonly id: string;
  version(): Promise<SyncBytes>;
  exportUpdate(from?: SyncBytes): Promise<SyncBytes>;
  exportSnapshot(): Promise<SyncBytes>;
  importUpdate(bytes: SyncBytes): Promise<void>;
};

/**
 * A composite of `SyncableDoc`s that declares its own sync plan. The sync engine drives the plan;
 * it does NOT understand the composite's internals (shards, ownership, heal policy). Two concerns
 * only, each owned by the composite:
 *
 *   - `docs()` — the docs to exchange, in exchange order. Earlier docs may reveal later ones when
 *     synced (the outliner's treeDoc carries ownership, so syncing it reveals which shard ids
 *     exist on each side). The sync engine RE-READS `docs()` after each exchange so newly-revealed
 *     docs are picked up; the composite materializes each returned doc (so a shard that just became
 *     owned is loaded on demand). Ids must be stable across re-reads (a doc once listed keeps its
 *     id). A doc the peer advertises but local has no content for never appears here and is
 *     correctly skipped — ownership (in the treeDoc) is the authority for which shards matter.
 *   - `heal()` — post-exchange reconcile (the outliner sweeps cross-doc orphans). No-op when not
 *     applicable. Distinct from crash-restart lifecycle healing, which is NOT a sync concern and
 *     does not belong here.
 *
 * This is the lode analog of any-sync's per-object sync channel set, expressed declaratively so the
 * driver stays business-agnostic.
 */
export type SyncableComposite = {
  docs(): SyncableDoc[];
  /** The docs to push on the fast-path — the subset that may carry local ops to push. For an eager
   *  composite this is `docs()`; a lazy composite (the outliner) returns only its already-materialized
   *  docs so a push doesn't force-load every owned doc. */
  pushDocs(): SyncableDoc[];
  heal(): Promise<void>;
  /** Per-doc monotonic revision (the change marker), keyed by SyncableDoc.id, or undefined for docs
   *  that don't track one (the tree). Enables INCREMENTAL sync: a round skips docs whose revision
   *  hasn't advanced since the last exchange AND whose peer version is unchanged. Omit entirely for a
   *  composite that doesn't support it → the driver falls back to exchanging every doc every round. */
  revisions?(): Map<string, number>;
};
