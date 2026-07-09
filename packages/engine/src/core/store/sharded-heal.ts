import { type LoroDoc, type LoroMap, type LoroTree, type TreeID } from "loro-crdt";
import type { NodeId } from "../types.js";
import type { ShardCache } from "./shard-cache.js";

/**
 * The crash-restart + sync-heal algorithms, extracted from `ShardedBlockStore`. TS can't split a
 * class across files, so these are free functions the store delegates to via a {@link HealContext}
 * (the store's heal-relevant surface). Moving them out leaves `ShardedBlockStore` a single cohesive
 * sharded-storage class (CRUD + sync surface) rather than "storage + two foreign heal algorithms".
 *
 * Like `sharded-store.ts` + `meta-doc.ts`, this is one of the store/ files that touches loro-crdt
 * directly — the heal algorithms walk the tree + shard entities. Kept store/-local.
 *
 * `reconcileDurability` and `sweepOrphans` are DISTINCT passes that must NOT be conflated:
 *   - `reconcileDurability` (entity-based, crash-restart): heals tree↔shard skew from a non-atomic
 *     restart. Must NOT run mid-sync.
 *   - `sweepOrphans` (ownership-based, post-exchange sync heal): sweeps occurrences whose ownership
 *     was hard-deleted on another replica. Ownership-based on purpose — an occurrence whose shard is
 *     merely PENDING (ownership present, entity not yet delivered) is NOT swept, so partial delivery
 *     self-heals when the shard arrives.
 */
export type HealContext = {
  numShards: number;
  occurrenceTree: LoroTree;
  ownership: LoroMap;
  shardCache: ShardCache<LoroDoc>;
  treeDoc: LoroDoc;
  /** RAW shard fault (no working-set session gate) — heal is infrastructure, not an operation, so
   *  it must not be gated by a concurrent operation's `ensureResident` session. */
  fault(id: string): Promise<LoroDoc>;
  /** RAW shard fault + markDirty (heal's "write" — mark the shard dirty so a deletion persists). */
  touch(id: string): Promise<LoroDoc>;
  entityPresent(nodeId: NodeId): Promise<boolean>;
  shardIdOfNode(nodeId: NodeId): string;
};

/** Commit the tree + every resident shard (a heal pass ends by making its deletes durable). */
function commitAll(ctx: HealContext): void {
  ctx.treeDoc.commit();
  for (const [, s] of ctx.shardCache.residentEntries()) {
    s.commit();
  }
}

/** The nodeIds of every live (non-deleted) occurrence — the post-drop live set each heal pass feeds
 *  to its ownership loop. Shared by both heal algorithms (the single getNodes scan they used to duplicate). */
function collectLiveNodeIds(ctx: HealContext): Set<NodeId> {
  const live = new Set<NodeId>();
  for (const node of ctx.occurrenceTree.getNodes({ withDeleted: false })) {
    const nid = node.data.get("nodeId");
    if (typeof nid === "string") {
      live.add(nid);
    }
  }
  return live;
}

/**
 * Crash recovery: reconcile treeDoc ↔ shards after a non-atomic restart. The tree doc and each shard
 * are independent LoroDocs (persisted separately), so a crash between their writes leaves two kinds
 * of incompleteness:
 *   CREATE-direction: occurrence + ownership present, shard entity absent.
 *   DELETE-direction: shard entity present, ownership already gone.
 * Run to a fixpoint; deterministic given tree-doc + shard state.
 */
export async function runReconcileDurability(ctx: HealContext): Promise<void> {
  for (let iter = 0; iter < 100; iter++) {
    let changed = false;
    // CREATE-direction: drop live occurrences pointing at a missing entity.
    const occsToDrop: TreeID[] = [];
    for (const node of ctx.occurrenceTree.getNodes({ withDeleted: false })) {
      const nid = node.data.get("nodeId");
      if (typeof nid === "string" && !(await ctx.entityPresent(nid))) {
        occsToDrop.push(node.id);
      }
    }
    for (const id of occsToDrop) {
      ctx.occurrenceTree.delete(id);
      changed = true;
    }
    // Ownership with neither a live occurrence nor an entity: crashed-create residue.
    const liveOccNodeIds = collectLiveNodeIds(ctx);
    for (const nid of [...(ctx.ownership.keys() as string[])]) {
      if (!liveOccNodeIds.has(nid) && !(await ctx.entityPresent(nid))) {
        ctx.ownership.delete(nid);
        changed = true;
      }
    }
    // DELETE-direction: orphan shard entities whose ownership is gone. Streaming — fault each shard
    // one at a time under the normal capacity (empty shards fault null + evict; a shard with an
    // orphan deletion is marked dirty so onEvict/persist preserves it). Gated to non-clean restart,
    // so this full scan only runs after a crash.
    for (let i = 0; i < ctx.numShards; i++) {
      const shardId = `s${i}`;
      const ents = (await ctx.fault(shardId)).getMap("entities");
      const stale: NodeId[] = [];
      for (const [nid] of ents.entries()) {
        if (typeof nid === "string" && ctx.ownership.get(nid) === undefined) {
          stale.push(nid);
        }
      }
      for (const nid of stale) {
        ents.delete(nid);
        changed = true;
      }
      if (stale.length > 0) {
        // Mark the shard dirty so the orphan deletion persists (else it reappears on reload).
        await ctx.touch(shardId);
      }
    }
    if (!changed) {
      break;
    }
  }
  commitAll(ctx);
}

/**
 * Sync heal (ownership-based). After exchanging treeDoc + shards, a live occurrence may reference a
 * node whose ownership was hard-deleted on another replica (a ref to X created concurrently with X's
 * deletion); such orphan occurrences are swept, and the entity + ownership of any node left with no
 * live occurrence are dropped. (No-resurrection rests on the CRDT permanence of `ownership.delete`,
 * not on a tombstone — the tombstone machinery was removed once verified not to carry correctness.)
 * Deterministic given tree-doc state, so every replica that exchanges the same bytes converges
 * identically.
 */
export async function runSweepOrphans(ctx: HealContext): Promise<void> {
  for (let iter = 0; iter < 100; iter++) {
    let changed = false;
    const occToRemove: TreeID[] = [];
    for (const node of ctx.occurrenceTree.getNodes({ withDeleted: false })) {
      const nid = node.data.get("nodeId");
      if (typeof nid === "string" && ctx.ownership.get(nid) === undefined) {
        occToRemove.push(node.id);
      }
    }
    for (const id of occToRemove) {
      ctx.occurrenceTree.delete(id);
      changed = true;
    }
    const liveOccNodeIds = collectLiveNodeIds(ctx);
    for (const nid of [...(ctx.ownership.keys() as string[])]) {
      if (!liveOccNodeIds.has(nid)) {
        const shardId = ctx.shardIdOfNode(nid);
        (await ctx.fault(shardId)).getMap("entities").delete(nid);
        await ctx.touch(shardId); // mark dirty so the orphan deletion persists
        ctx.ownership.delete(nid);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
  commitAll(ctx);
}
