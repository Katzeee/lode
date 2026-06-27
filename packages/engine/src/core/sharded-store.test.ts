import { describe, expect, it } from "vitest";
import { Engine } from "./engine.js";
import { ShardedBlockStore } from "./sharded-store.js";
import { validateSnapshot } from "./invariant.js";
import { toJSON } from "./serializers/json.js";
import type { Delta } from "./types.js";

/**
 * ShardedBlockStore smoke — the sharded store (treeDoc + N content shards) round-trips
 * the full production data model (content resolved from shards, entity + occurrence
 * props/meta) and stays structurally valid. Correctness across the whole mutator
 * surface is covered independently by `tests/correctness.test.ts` (the truth fuzz); this
 * file is the sharded store's own data-model + cycle-guard + fan-out witness.
 *
 * NOTE on a pre-existing Loro issue (NOT sharding-specific): `occurrenceTree.getNodeByID(ref)`
 * panics for certain reference-occurrence shapes. The scenarios below create references
 * (they appear in `toJSON`) but only READ via original occurrences and compare via
 * `toJSON` (which traverses with `.children()`, not getNodeByID).
 */

const textToDelta = (s: string): Delta => [{ insert: s }];

describe("ShardedBlockStore smoke: full production data model round-trips, structurally valid", () => {
  it("content + marks read back from shards; occurrence/entity props+meta survive", () => {
    const e = new Engine({ store: new ShardedBlockStore({ numShards: 8 }) });
    const root = e.createNode(null);
    const a = e.createNode(root.occurrenceId, undefined, { kind: "page" });
    e.replaceDeltas(a.occurrenceId, textToDelta("hello world"));
    e.mark(a.occurrenceId, { start: 0, end: 5 }, "bold", true);
    e.setOccurrenceMeta(a.occurrenceId, "managed", { kind: "fieldSlot" });
    e.setEntityMeta(a.occurrenceId, "updated", 1);

    // Content + marks resolve from the shard (read via the original occurrence).
    expect(e.getOccurrence(a.occurrenceId)?.deltas).toEqual([
      { insert: "hello", attributes: { bold: true } },
      { insert: " world" },
    ]);
    expect(e.getOccurrenceMetaRecord(a.occurrenceId)).toEqual({ managed: { kind: "fieldSlot" } });
    expect(e.getEntityMetaRecord(a.occurrenceId)).toEqual({ updated: 1 });

    validateSnapshot(toJSON(e));
  });

  it("shards fan out across multiple docs and the snapshot stays valid", () => {
    const store = new ShardedBlockStore({ numShards: 4 });
    const e = new Engine({ store });
    const root = e.createNode(null);
    for (let i = 0; i < 40; i++) {
      e.createNode(root.occurrenceId);
    }
    expect(store.shardIds().length).toBeGreaterThan(1); // fan-out happened
    validateSnapshot(toJSON(e));
  });

  it("the cycle guard rejects a cycle-forming move cleanly (no WASM abort)", () => {
    const e = new Engine({ store: new ShardedBlockStore({ numShards: 4 }) });
    const root = e.createNode(null);
    const a = e.createNode(root.occurrenceId); // a is parent of b
    const b = e.createNode(a.occurrenceId);
    expect(() => e.moveOccurrence(a.occurrenceId, b.occurrenceId)).toThrow(/cycle/i);
    validateSnapshot(toJSON(e));
  });
});
