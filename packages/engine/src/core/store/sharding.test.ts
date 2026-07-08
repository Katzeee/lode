import { describe, expect, it } from "vitest";
import { VIRTUAL_BUCKETS, bucketOf, hashOfNodeId, shardIdOf, shardIdOfBucket } from "./sharding.js";

/**
 * Virtual-bucket sharding math — numShards is reversible. Ported from the prototype's
 * reshard.test.ts. Pure functions; no Engine needed.
 *
 * ownership stores a node's permanent BUCKET (hash mod P). The bucket→shard grouping
 * is a function of the CURRENT numShards, so numShards can be raised later via
 * power-of-two split-doubling (S→2S partitions each shard in two by bucket) without
 * re-hashing any node.
 */

describe("virtual-bucket sharding: numShards is reversible", () => {
  it("VIRTUAL_BUCKETS is a power of two well above any plausible numShards", () => {
    expect(VIRTUAL_BUCKETS).toBe(4096);
    expect(VIRTUAL_BUCKETS & (VIRTUAL_BUCKETS - 1)).toBe(0); // power of two
  });

  it("buckets are stable, deterministic, in range [0, P)", () => {
    for (let i = 0; i < 2000; i++) {
      const id = `node-${i}`;
      const b = bucketOf(id);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(VIRTUAL_BUCKETS);
      expect(bucketOf(id)).toBe(b); // deterministic
      expect(hashOfNodeId(id) % VIRTUAL_BUCKETS).toBe(b); // matches definition
    }
  });

  it("shardIdOf is consistent with shardIdOfBucket(bucketOf(id), S)", () => {
    for (let i = 0; i < 500; i++) {
      const id = `n${i}`;
      for (const s of [1, 2, 4, 8, 64, 256, 1024]) {
        expect(shardIdOf(id, s)).toBe(shardIdOfBucket(bucketOf(id), s));
      }
    }
  });

  it("contiguous grouping: shard k owns bucket range [k·P/S, (k+1)·P/S)", () => {
    const S = 8;
    const width = VIRTUAL_BUCKETS / S;
    for (let k = 0; k < S; k++) {
      // Buckets at the start, middle, and end of shard k's range all map to "sk".
      expect(shardIdOfBucket(k * width, S)).toBe(`s${k}`);
      expect(shardIdOfBucket(k * width + Math.floor(width / 2), S)).toBe(`s${k}`);
      expect(shardIdOfBucket((k + 1) * width - 1, S)).toBe(`s${k}`);
    }
  });

  it("doubling S splits each shard cleanly in two (the reshard property)", () => {
    // Every node in shard k at S lands in shard 2k or 2k+1 at 2S. So S→2S migration
    // splits each shard doc by bucket into two — no node crosses into an unrelated shard.
    for (let i = 0; i < 10000; i++) {
      const id = `node${i}`;
      const b = bucketOf(id);
      for (const S of [2, 4, 8, 16, 64, 256]) {
        const k = Number(shardIdOfBucket(b, S).slice(1));
        const k2 = Number(shardIdOfBucket(b, S * 2).slice(1));
        expect(k2 === 2 * k || k2 === 2 * k + 1).toBe(true);
      }
    }
  });

  it("the same nodeId always maps to the same shard across replicas (convergence)", () => {
    // Two "replicas" with the same numShards assign the same shard.
    for (let i = 0; i < 500; i++) {
      const id = `convergence-${i}`;
      expect(shardIdOf(id, 256)).toBe(shardIdOf(id, 256));
    }
  });
});
