import type { NodeId } from "../types.js";

/**
 * Deterministic sharding math. A node's BUCKET (`hash mod P`) is permanent — it is
 * what `ownership` stores — so the nodeId→bucket assignment never changes. The
 * bucket→shard grouping (`shardIdOfBucket`) is a function of the CURRENT numShards,
 * so numShards can be raised later (power-of-two split-doubling) by regrouping
 * buckets into more shard docs, without re-hashing any node.
 *
 * Ported from `experiments/multi-shard-tree/src/sharded-engine.ts`.
 */

/** Fixed virtual-bucket space. Power of two, well above any plausible numShards. */
export const VIRTUAL_BUCKETS = 4096;

/** Deterministic nodeId hash (djb2). Stable across replicas and across numShards. */
export function hashOfNodeId(nodeId: NodeId): number {
  let h = 5381;
  for (let i = 0; i < nodeId.length; i++) {
    h = ((h * 33) ^ nodeId.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** The permanent virtual bucket a node maps to (0 .. VIRTUAL_BUCKETS-1). */
export function bucketOf(nodeId: NodeId): number {
  return hashOfNodeId(nodeId) % VIRTUAL_BUCKETS;
}

/**
 * Which shard doc a bucket lives in, given the current numShards. Contiguous bucket
 * ranges per shard (not mod-classes): shard k owns buckets [k·P/S, (k+1)·P/S), so
 * doubling S splits each shard cleanly in two — the reshard-friendly grouping.
 */
export function shardIdOfBucket(bucket: number, numShards: number): string {
  return `s${Math.floor((bucket * numShards) / VIRTUAL_BUCKETS)}`;
}

/** Deterministic shard assignment: same nodeId → same shard on every replica. */
export function shardIdOf(nodeId: NodeId, numShards: number): string {
  return shardIdOfBucket(bucketOf(nodeId), numShards);
}
