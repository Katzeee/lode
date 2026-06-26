// bench/run-shard-sizing.ts — measure the number that decides numShards.
//
//   node --import tsx --max-old-space-size=4096 experiments/multi-shard-tree/bench/run-shard-sizing.ts
//
// The one unmeasured quantity behind the numShards choice: the FIXED overhead of a
// shard doc (LoroDoc header + version vector + empty `entities` map), independent of
// content. That overhead × S is the price of finer sharding. This measures it, then
// sweeps S to show total-storage overhead and cold-start cost scaling, so the initial
// numShards is set by data, not a guess.

import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LoroDoc, LoroMap, LoroText } from "loro-crdt";
import { SingleDocEngine } from "../src/single-doc-engine.js";
import { ShardedEngine, shardIdOf } from "../src/sharded-engine.js";

const SELF = fileURLToPath(import.meta.url);
const HERE = dirname(SELF);
const now = (): number => performance.now();
const CONTENT = "01234567890123456789"; // ~20 chars
const fmt = (x: number, d = 2): string => (Number.isFinite(x) ? x.toFixed(d) : "n/a");

/** A shard-shaped LoroDoc: an `entities` map (mirrors ShardedEngine.shard()). */
function newShardDoc(): LoroDoc {
  const d = new LoroDoc();
  d.configTextStyle({ bold: { expand: "after" }, italic: { expand: "after" } });
  d.getMap("entities");
  d.commit();
  return d;
}

function addEntity(doc: LoroDoc, nodeId: string, occ: string): void {
  const entity = doc.getMap("entities").setContainer(nodeId, new LoroMap());
  entity.set("canonicalOccurrenceId", occ);
  entity.setContainer("content", new LoroText()).insert(0, CONTENT);
  entity.setContainer("props", new LoroMap());
  entity.setContainer("meta", new LoroMap());
  doc.commit();
}

function snapBytes(doc: LoroDoc): number {
  return doc.export({ mode: "snapshot" }).length;
}

function buildWide(e: SingleDocEngine | ShardedEngine, n: number): void {
  const root = e.createNode("root", null, undefined, "root");
  for (let i = 0; i < n; i++) e.createNode(`n${i}`, root, undefined, CONTENT);
  e.commit();
}

function main(): void {
  const lines: string[] = [];
  const log = (s: string): void => {
    // eslint-disable-next-line no-console
    console.log(s);
    lines.push(s);
  };
  const stamp = new Date().toISOString().slice(0, 10);
  log("# shard-sizing — the numbers behind numShards");
  log("");
  log(`_loro-crdt, ${stamp}_`);
  log("");

  // ── 1. Per-shard FIXED overhead + per-entity marginal ───────────────────────
  const empty = newShardDoc();
  const cFixed = snapBytes(empty);
  empty.free();
  const slopes: number[] = [];
  const counts = [1, 10, 100];
  for (const k of counts) {
    const d = newShardDoc();
    for (let i = 0; i < k; i++) addEntity(d, `n${i}`, `occ${i}`);
    slopes.push((snapBytes(d) - cFixed) / k);
    d.free();
  }
  const perEntity = slopes[slopes.length - 1]!; // large-k marginal is cleanest
  log("## 1. Per-shard fixed overhead + per-entity marginal");
  log("");
  log(`- **C_fixed (empty shard doc): ${cFixed} B**`);
  log(`- per-entity marginal (at 100 entities): **${fmt(perEntity, 1)} B/entity**`);
  log(
    `- (slope at 1 / 10 entities: ${fmt(slopes[0]!, 1)} / ${fmt(slopes[1]!, 1)} B/entity — front-loaded container cost amortizes)`,
  );
  log("");

  // ── 2. Total storage vs S (N = 50k) ─────────────────────────────────────────
  const N = 50_000;
  const Ss = [16, 64, 128, 256, 512, 1024];
  // Single-doc baseline (the thing sharding trades against).
  const single = new SingleDocEngine();
  buildWide(single, N);
  const singleBytes = snapBytes((single as unknown as { doc: LoroDoc }).doc);
  single.free?.();

  log(
    `## 2. Total storage vs numShards (N = ${N.toLocaleString()} nodes, ~${CONTENT.length}-char content)`,
  );
  log("");
  log(
    `- single-doc baseline: **${(singleBytes / N).toFixed(1)} B/node** (${(singleBytes / 1024 / 1024).toFixed(1)} MB)`,
  );
  log("");
  log(
    "| S | sum of shard snaps | + treeDoc | total B/node | shard-fixed overhead | overhead % of content |",
  );
  log(
    "|---|--------------------|-----------|--------------|----------------------|-----------------------|",
  );
  const rows: { S: number; total: number; coldMs: number }[] = [];
  for (const S of Ss) {
    const e = new ShardedEngine(S);
    buildWide(e, N);
    let shardSum = 0;
    for (const sid of e.shardIds()) shardSum += snapBytes(e.getShardDoc(sid));
    const treeBytes = snapBytes(e.treeDoc);
    const total = shardSum + treeBytes;
    const fixedOverhead = S * cFixed; // the price of S docs
    const contentBytes = N * perEntity;
    log(
      `| ${S} | ${(shardSum / 1024).toFixed(0)} KB | ${(treeBytes / 1024).toFixed(0)} KB | ${fmt(
        total / N,
        1,
      )} | ${(fixedOverhead / 1024).toFixed(0)} KB | ${fmt((fixedOverhead / contentBytes) * 100, 2)}% |`,
    );
    rows.push({ S, total, coldMs: 0 });
    for (const d of e.syncDocs()) d.free?.();
  }
  log("");
  log(
    `_shard-fixed overhead = S × C_fixed (${cFixed} B). "% of content" = overhead ÷ (N × per-entity)._`,
  );
  log("");

  // ── 3. Cold start: treeDoc + the shards a small view touches, vs S ───────────
  // A view of V nodes, hash-scattered over S shards, touches D ≈ S·(1−e^(−V/S)).
  // Time to import treeDoc + those D shards (the lazy cold-start a client pays).
  log("## 3. Cold start (treeDoc + shards touched by a 50-node view) vs S");
  log("");
  log("| S | shards touched (expected) | cold-start ms | vs eager-all |");
  log("|---|----------------------------|---------------|--------------|");
  const N3 = 10_000;
  const V = 50;
  const median = (xs: number[]): number =>
    [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  for (const S of [64, 256, 1024]) {
    const e = new ShardedEngine(S);
    buildWide(e, N3);
    const treeBytes = e.treeDoc.export({ mode: "snapshot" });
    const shardBytes = new Map<string, Uint8Array>();
    for (const sid of e.shardIds())
      shardBytes.set(sid, e.getShardDoc(sid).export({ mode: "snapshot" }));
    for (const d of e.syncDocs()) d.free?.();
    globalThis.gc?.();

    const loader = (sid: string): Uint8Array | null => shardBytes.get(sid) ?? null;
    const viewNodeIds: string[] = [];
    for (let i = 0; i < V; i++) viewNodeIds.push(`n${i}`);
    const touchedShards = new Set(viewNodeIds.map((id) => shardIdOf(id, S)));
    const expectedD = S * (1 - Math.exp(-V / S));

    const coldTimes: number[] = [];
    const eagerTimes: number[] = [];
    for (let t = 0; t < 5; t++) {
      const a = now();
      const eng = new ShardedEngine(S, treeBytes, loader);
      for (const sid of touchedShards) eng.getShardDoc(sid);
      coldTimes.push(now() - a);
      for (const d of eng.syncDocs()) d.free?.();
      const b = now();
      const eng2 = new ShardedEngine(S, treeBytes, loader);
      for (const sid of shardBytes.keys()) eng2.getShardDoc(sid);
      eagerTimes.push(now() - b);
      for (const d of eng2.syncDocs()) d.free?.();
      globalThis.gc?.();
    }
    const cold = median(coldTimes);
    const eager = median(eagerTimes);
    log(
      `| ${S} | ~${expectedD.toFixed(0)} (actual ${touchedShards.size}) | ${fmt(cold, 2)} | ${fmt(cold / eager, 3)}× |`,
    );
    void rows;
  }
  log("");

  // ── 4. Reading ──────────────────────────────────────────────────────────────
  log("## Reading");
  log("");
  log(
    `- C_fixed = ${cFixed} B is the per-doc price. At S shards the fixed overhead is S × ${cFixed} B.`,
  );
  log("- Pick S so that fixed overhead is an acceptable % of content (the table's last column),");
  log(
    "  while keeping shards granular enough that a view's cold-start (§3) stays a small fraction",
  );
  log("  of eager-all. Power-of-two S keeps future split-doubling clean.");

  writeFileSync(join(HERE, "shard-sizing-results.md"), lines.join("\n") + "\n");
  // eslint-disable-next-line no-console
  console.log("\n=> wrote " + join(HERE, "shard-sizing-results.md"));
}

main();
