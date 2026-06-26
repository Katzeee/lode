import { describe, expect, it } from "vitest";
import {
  ShardedEngine,
  VIRTUAL_BUCKETS,
  bucketOf,
  shardIdOfBucket,
  shardIdOf,
} from "../src/sharded-engine.js";

/**
 * numShards strategy — the virtual-bucket design makes numShards REVERSIBLE.
 *
 * ownership stores a node's permanent BUCKET (`hash mod P`, P=VIRTUAL_BUCKETS),
 * NOT the shardId. The bucket→shard mapping is a function of the CURRENT numShards,
 * so numShards can be raised later (power-of-two split-doubling) by regrouping
 * buckets into more shard docs — without ever re-hashing a node. These tests pin
 * the load-bearing properties: bucket stability, contiguous grouping, and that
 * doubling S refines (splits) each shard cleanly in two.
 */

describe("virtual-bucket sharding: numShards is reversible", () => {
  it("buckets are stable, in range, and a power-of-two space with headroom", () => {
    expect(VIRTUAL_BUCKETS).toBe(4096);
    expect((VIRTUAL_BUCKETS & (VIRTUAL_BUCKETS - 1)) === 0).toBe(true); // power of two
    for (let i = 0; i < 1000; i++) {
      const b = bucketOf(`node${i}`);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(VIRTUAL_BUCKETS);
      expect(bucketOf(`node${i}`)).toBe(b); // deterministic
    }
  });

  it("contiguous grouping: shard k owns bucket range [k·P/S, (k+1)·P/S)", () => {
    const S = 8;
    const P = VIRTUAL_BUCKETS;
    const width = P / S;
    for (let k = 0; k < S; k++) {
      // Buckets in shard k's range map to "sk"; the boundaries map to neighbors.
      expect(shardIdOfBucket(k * width, S)).toBe(`s${k}`);
      expect(shardIdOfBucket(k * width + Math.floor(width / 2), S)).toBe(`s${k}`);
    }
  });

  it("doubling S splits each shard cleanly in two (the reshard property)", () => {
    // For every node, shard@2S is a REFINEMENT of shard@S: specifically, every
    // node in shard k at S lands in shard 2k or 2k+1 at 2S. So S→2S migration
    // splits each shard doc's entities by bucket into two new docs — no node
    // crosses into an unrelated shard.
    for (let i = 0; i < 5000; i++) {
      const id = `node${i}`;
      const b = bucketOf(id);
      for (const S of [2, 4, 8, 16, 64, 256]) {
        const k = Number(shardIdOfBucket(b, S).slice(1));
        const k2 = Number(shardIdOfBucket(b, S * 2).slice(1));
        expect(k2 === 2 * k || k2 === 2 * k + 1).toBe(true);
      }
    }
  });

  it("ownership stores the BUCKET (permanent), not the shardId (current-S)", () => {
    const e = new ShardedEngine(8);
    const root = e.createNode("root", null);
    for (let i = 0; i < 40; i++) e.createNode(`n${i}`, root);
    e.commit();
    for (let i = 0; i < 40; i++) {
      const stored = e.treeDoc.getMap("ownership").get(`n${i}`);
      expect(typeof stored).toBe("number"); // a bucket, not "sN"
      expect(stored).toBe(bucketOf(`n${i}`));
    }
  });

  it("a node's bucket is invariant to the engine's numShards (re-derivation is safe)", () => {
    // Build under S=4; the same nodeId derives a consistent, refined shard under
    // any other S. (The entity bytes live in the S=4 shard doc; a real reshard
    // moves them to the refined doc — but the ASSIGNMENT logic is stable, which
    // is what makes resharding a regrouping, not a re-hash.)
    const e = new ShardedEngine(4);
    const root = e.createNode("root", null);
    e.createNode("x", root, undefined, "X");
    e.commit();
    const b = bucketOf("x");
    // The bucket is what ownership holds; shardId is derived for whatever S.
    expect(e.treeDoc.getMap("ownership").get("x")).toBe(b);
    expect(shardIdOf("x", 4)).toBe(shardIdOfBucket(b, 4));
    expect(shardIdOf("x", 8)).toBe(shardIdOfBucket(b, 8));
    // And shard@8 is a split of shard@4:
    const k4 = Number(shardIdOf("x", 4).slice(1));
    const k8 = Number(shardIdOf("x", 8).slice(1));
    expect(k8 === 2 * k4 || k8 === 2 * k4 + 1).toBe(true);
  });
});
