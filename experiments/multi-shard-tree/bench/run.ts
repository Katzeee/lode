// bench/run.ts — standalone big-N sizing evidence for the sharded engine.
//
//   node --import tsx --expose-gc --max-old-space-size=4096 \
//        experiments/multi-shard-tree/bench/run.ts [--small]
//
// Sizing RSS is measured in a FRESH CHILD PROCESS per workload (--worker mode):
// loro-crdt is WASM-backed and does not return its arena to the OS after free,
// so in-process RSS deltas are contaminated by prior measurements. A child per
// workload gives a clean before/after delta and dies before the next (hard rule:
// one workload at a time). Writes bench/bench-results.md and prints a summary.
//
// What it proves (the prototype proved CORRECTNESS, not BENEFIT):
//   1. Sizing   — treeDoc is materially smaller than the full single-doc (RSS + bytes).
//   2. ColdLoad — treeDoc-only cold load is faster than full.
//   3. Lazy     — incremental per-shard load lets a view pay for only the shards it touches.
//   4. SyncBytes— per-shard deltas enable partial sync (a peer pays for one shard, not all edits).
//   5. Sweep    — sweepTombstones scan cost is affordable at scale.

import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import type { VersionVector } from "loro-crdt";
import { SingleDocEngine } from "../src/single-doc-engine.js";
import { ShardedEngine } from "../src/sharded-engine.js";

const SELF = fileURLToPath(import.meta.url);
const HERE = dirname(SELF);
const gc = (): void => globalThis.gc?.();
const now = (): number => performance.now();
const small = process.argv.includes("--small");
const SIZES = small ? [1_000, 10_000] : [1_000, 10_000, 50_000, 100_000];
const CONTENT = "01234567890123456789"; // ~20 chars

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type DocLike = { free?: () => void };
const freeDocs = (docs: Iterable<DocLike>): void => {
  for (const d of docs) d.free?.();
  gc();
};

function buildWide(e: SingleDocEngine | ShardedEngine, n: number): string {
  const root = e.createNode("root", null, undefined, "root node here!!!!");
  for (let i = 0; i < n; i++) {
    e.createNode(`n${i}`, root, undefined, `${CONTENT}${i}`.slice(0, 20));
  }
  e.commit();
  return root;
}

// ── worker mode: one measurement in a fresh process, print JSON, exit ─────────
type Measure = { buildMs: number; rssKBPerNode: number; snapBPerNode: number };
function workerSize(variant: string, n: number): void {
  gc();
  const base = process.memoryUsage().rss;
  if (variant === "full") {
    const f0 = now();
    const e = new SingleDocEngine();
    buildWide(e, n);
    const buildMs = now() - f0;
    const snap = e.exportSnapshotBytes().length;
    gc();
    const rss = Math.max(0, process.memoryUsage().rss - base);
    e.free();
    report({ buildMs, rssKBPerNode: rss / 1024 / n, snapBPerNode: snap / n });
    return;
  }
  // treeDoc: build full sharded for tree-snapshot + build time, then measure a
  // treeDoc-only (lazy) engine's RSS in this same fresh process.
  const f0 = now();
  const shard = new ShardedEngine(8);
  buildWide(shard, n);
  const buildMs = now() - f0;
  const treeBytes = shard.treeDoc.export({ mode: "snapshot" });
  freeDocs(shard.syncDocs());

  gc();
  const base2 = process.memoryUsage().rss;
  const lazy = new ShardedEngine(8, treeBytes);
  gc();
  const rss = Math.max(0, process.memoryUsage().rss - base2);
  freeDocs(lazy.syncDocs());
  report({ buildMs, rssKBPerNode: rss / 1024 / n, snapBPerNode: treeBytes.length / n });
}

const report = (m: Measure): void => {
  process.stdout.write(JSON.stringify(m));
};

/** Spawn a fresh child for one measurement, return its parsed result. */
function measureInChild(variant: string, n: number): Measure {
  const r = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--expose-gc",
      "--max-old-space-size=4096",
      SELF,
      "--worker",
      variant,
      String(n),
    ],
    { encoding: "utf8", timeout: 300_000 },
  );
  if (r.status !== 0 || !r.stdout.trim()) {
    throw new Error(`worker ${variant} n=${n} failed: ${(r.stderr ?? "").slice(-500)}`);
  }
  return JSON.parse(r.stdout.trim()) as Measure;
}

// ── 1. Sizing (via child workers) ────────────────────────────────────────────
type SizeRow = {
  n: number;
  variant: "full" | "treeDoc";
  buildMs: number;
  rssKBPerNode: number;
  snapBPerNode: number;
  snapRatio: number;
  rssRatio: number;
};
function sizing(n: number): SizeRow[] {
  const full = measureInChild("full", n);
  const tree = measureInChild("treeDoc", n);
  return [
    { n, variant: "full", ...full, snapRatio: 1, rssRatio: 1 },
    {
      n,
      variant: "treeDoc",
      ...tree,
      snapRatio: tree.snapBPerNode / full.snapBPerNode,
      rssRatio: full.rssKBPerNode > 0 ? tree.rssKBPerNode / full.rssKBPerNode : 0,
    },
  ];
}

// ── 2. Cold load (in-process; relative timing is reliable) ───────────────────
function coldLoad(n: number): { fullMs: number; treeMs: number } {
  const full = new SingleDocEngine();
  buildWide(full, n);
  const fullBytes = full.exportSnapshotBytes();
  freeDocs([full]);

  const shard = new ShardedEngine(8);
  buildWide(shard, n);
  const treeBytes = shard.treeDoc.export({ mode: "snapshot" });
  freeDocs(shard.syncDocs());

  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)]!;
  };
  const ft: number[] = [];
  const tt: number[] = [];
  for (let i = 0; i < 9; i++) {
    const a = now();
    const f = new SingleDocEngine(fullBytes);
    ft.push(now() - a);
    freeDocs([f]);
    const b = now();
    const s = new ShardedEngine(8, treeBytes);
    tt.push(now() - b);
    freeDocs(s.syncDocs());
  }
  return { fullMs: median(ft.slice(1)), treeMs: median(tt.slice(1)) };
}

// ── 3. Lazy shard load ────────────────────────────────────────────────────────
// A view touching K of N shards pays coldTreeLoad + K·perShardLoad, not the full
// content load. Measure coldTreeLoad + perShardLoad and report the view-cost for
// touching 1 shard vs all shards.
function lazyShard(n: number): {
  numShards: number;
  coldTreeMs: number;
  perShardMs: number;
  touchOneMs: number;
  eagerAllMs: number;
} {
  const NUM = 64;
  const e = new ShardedEngine(NUM);
  buildWide(e, n);
  const treeBytes = e.treeDoc.export({ mode: "snapshot" });
  const shardBytes = new Map<string, Uint8Array>();
  for (const sid of e.shardIds())
    shardBytes.set(sid, e.getShardDoc(sid).export({ mode: "snapshot" }));
  freeDocs(e.syncDocs());

  const loader = (sid: string): Uint8Array | null => shardBytes.get(sid) ?? null;
  const median = (xs: number[]): number =>
    [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

  const tt: number[] = [];
  for (let i = 0; i < 7; i++) {
    const a = now();
    const s = new ShardedEngine(NUM, treeBytes, loader);
    tt.push(now() - a);
    freeDocs(s.syncDocs());
  }
  const coldTreeMs = median(tt);

  const firstSid = shardBytes.keys().next().value as string;
  const ps: number[] = [];
  for (let i = 0; i < 7; i++) {
    const s = new ShardedEngine(NUM, treeBytes, loader);
    const a = now();
    s.getShardDoc(firstSid);
    ps.push(now() - a);
    freeDocs(s.syncDocs());
  }
  const perShardMs = median(ps);

  const a = now();
  const lazy = new ShardedEngine(NUM, treeBytes, loader);
  lazy.getShardDoc(firstSid);
  const touchOneMs = now() - a;
  freeDocs(lazy.syncDocs());

  const b = now();
  const eager = new ShardedEngine(NUM, treeBytes, loader);
  for (const sid of shardBytes.keys()) eager.getShardDoc(sid);
  const eagerAllMs = now() - b;
  freeDocs(eager.syncDocs());

  return { numShards: NUM, coldTreeMs, perShardMs, touchOneMs, eagerAllMs };
}

// ── 4. Sync update bytes ──────────────────────────────────────────────────────
function syncBytes(
  n: number,
  edits: number,
): {
  singleDocBytes: number;
  shardedSumBytes: number;
  treeDocBytes: number;
  maxShardBytes: number;
  shardsTouched: number;
} {
  const full = new SingleDocEngine();
  buildWide(full, n);
  const vvFull = full.version();
  const r1 = rng(1);
  for (let i = 0; i < edits; i++) full.setText(`n${Math.floor(r1() * n)}`, `edit-${i}`);
  full.commit();
  const singleDocBytes = full.exportUpdateFrom(vvFull).length;
  freeDocs([full]);

  const shard = new ShardedEngine(64);
  buildWide(shard, n);
  const vvTree = shard.treeDoc.version();
  const vvByShard = new Map<string, VersionVector>();
  for (const sid of shard.shardIds()) vvByShard.set(sid, shard.getShardDoc(sid).version());
  const r2 = rng(1); // SAME picks => same nodes edited
  for (let i = 0; i < edits; i++) shard.setText(`n${Math.floor(r2() * n)}`, `edit-${i}`);
  shard.commit();
  const treeDocBytes = shard.treeDoc.export({ mode: "update", from: vvTree }).length;
  let sum = treeDocBytes;
  let max = 0;
  let touched = 0;
  for (const sid of shard.shardIds()) {
    const b = shard.getShardDoc(sid).export({ mode: "update", from: vvByShard.get(sid)! }).length;
    if (b > 0) touched++;
    sum += b;
    if (b > max) max = b;
  }
  freeDocs(shard.syncDocs());
  return {
    singleDocBytes,
    shardedSumBytes: sum,
    treeDocBytes,
    maxShardBytes: max,
    shardsTouched: touched,
  };
}

// ── 5. Sweep cost ─────────────────────────────────────────────────────────────
function sweepCost(n: number, deletes: number): { sweepMs: number; perDeleteMs: number } {
  const shard = new ShardedEngine(8);
  buildWide(shard, n);
  const r = rng(5);
  const ids = new Set<string>();
  for (let i = 0; i < deletes; i++) ids.add(`n${Math.floor(r() * n)}`);
  for (const id of ids) shard.hardDeleteNode(id);
  shard.commit();
  const a = now();
  shard.sweepTombstones();
  const sweepMs = now() - a;
  freeDocs(shard.syncDocs());
  return { sweepMs, perDeleteMs: sweepMs / ids.size };
}

// ── run + report ──────────────────────────────────────────────────────────────
function fmt(x: number, d = 2): string {
  return Number.isFinite(x) ? x.toFixed(d) : "n/a";
}

function main(): void {
  const lines: string[] = [];
  const log = (s: string): void => {
    // eslint-disable-next-line no-console
    console.log(s);
    lines.push(s);
  };
  const stamp = new Date().toISOString().slice(0, 10);

  log("# bench-results — multi-shard single-tree engine");
  log("");
  log(
    "_loro-crdt 1.11.0, node " +
      process.version +
      ", --expose-gc, " +
      SIZES.join("/") +
      " nodes, " +
      stamp +
      "_",
  );
  log("");

  log("## 1. Sizing — full single-doc vs treeDoc-only (per node, RSS via fresh child process)");
  log("");
  log("| N | variant | build ms | RSS KB/node | snap B/node | snap ratio | rss ratio |");
  log("|---|---------|----------|-------------|-------------|------------|-----------|");
  for (const n of SIZES) {
    for (const row of sizing(n)) {
      log(
        "| " +
          n.toLocaleString() +
          " | " +
          row.variant +
          " | " +
          fmt(row.buildMs, 0) +
          " | " +
          fmt(row.rssKBPerNode, 2) +
          " | " +
          fmt(row.snapBPerNode, 1) +
          " | " +
          fmt(row.snapRatio, 3) +
          " | " +
          fmt(row.rssRatio, 3) +
          " |",
      );
    }
  }
  log("");
  log("_treeDoc row RSS is a treeDoc-only (lazy) engine: structure without content._");

  const coldN = small ? 10_000 : 50_000;
  log("");
  log("## 2. Cold load — import a snapshot (median, N=" + coldN.toLocaleString() + ")");
  log("");
  const cold = coldLoad(coldN);
  log("- full single-doc: **" + fmt(cold.fullMs) + " ms**");
  log(
    "- treeDoc-only:    **" +
      fmt(cold.treeMs) +
      " ms** (tree/full = " +
      fmt(cold.treeMs / cold.fullMs, 3) +
      ")",
  );
  log("_Structure is available at the treeDoc cost; content streams in per shard._");

  const lazyN = small ? 10_000 : 50_000;
  log("");
  log("## 3. Lazy shard load (N=" + lazyN.toLocaleString() + ", 64 shards)");
  log("");
  const lz = lazyShard(lazyN);
  log("- cold tree-only start: **" + fmt(lz.coldTreeMs) + " ms**");
  log("- incremental per-shard load: **" + fmt(lz.perShardMs, 3) + " ms**");
  log("- touch ONE shard (cold tree + 1 shard): **" + fmt(lz.touchOneMs) + " ms**");
  log("- eager load ALL 64 shards: **" + fmt(lz.eagerAllMs) + " ms**");
  log(
    "- view touching 1 shard costs ~" + fmt(lz.touchOneMs / lz.eagerAllMs, 3) + "x of eager-all.",
  );

  log("");
  log("## 4. Sync update bytes — edit 100 of 2,000 nodes");
  log("");
  const sb = syncBytes(2_000, 100);
  log("- single-doc update (all edits, one doc): **" + sb.singleDocBytes + " B**");
  log(
    "- sharded sum (tree + every shard delta): **" +
      sb.shardedSumBytes +
      " B** (treeDoc=" +
      sb.treeDocBytes +
      " B, shards touched=" +
      sb.shardsTouched +
      ")",
  );
  log(
    "- largest single-shard delta: **" +
      sb.maxShardBytes +
      " B** — a peer wanting one shard pays this, not the whole-doc update.",
  );
  log("_Partial sync: peers exchange only the shards they hold, not the entire edit set._");

  log("");
  log("## 5. Sweep cost — delete 1,000 of 5,000, then sweepTombstones");
  log("");
  const sw = sweepCost(5_000, 1_000);
  log(
    "- sweepTombstones fixpoint scan: **" +
      fmt(sw.sweepMs, 1) +
      " ms** (" +
      fmt(sw.perDeleteMs, 3) +
      " ms/delete)",
  );

  const out = lines.join("\n") + "\n";
  writeFileSync(join(HERE, "bench-results.md"), out);
  // eslint-disable-next-line no-console
  console.log("\n=> wrote " + join(HERE, "bench-results.md"));
}

// Dispatch: --worker <variant> <n> runs one measurement in a fresh child; else main.
if (process.argv[2] === "--worker") {
  workerSize(process.argv[3]!, Number(process.argv[4]));
} else {
  main();
}
