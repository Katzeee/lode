/**
 * Engine Capacity Benchmark
 * Run: node_modules/.bin/tsx tests/benchmark/capacity.ts
 *
 *   USER    — engine.createNode + engine.replaceDeltas one-by-one
 *             (each call → 1 Loro commit)
 *             Models: real user interactions
 *
 *   BATCHED — Engine.transact() wrapping all creates + text
 *             (single Loro commit for everything)
 *             Models: bulk import (Markdown, JSON, initial load)
 *
 *   TYPING  — char-by-char LoroText.insert(), commit per block
 *             (~80 Loro ops/block vs 1 for BATCHED)
 *             Models: keystroke-level editing over lifetime of document
 */

import { Engine } from "../../src/core/engine.js";
import { ShardedBlockStore } from "../../src/core/store/sharded-store.js";
import { textToDelta } from "../../src/core/delta.js";
import type { OccurrenceId } from "../../src/core/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (b: number) =>
  b < 1024
    ? `${b} B`
    : b < 1_048_576
      ? `${(b / 1024).toFixed(1)} KB`
      : `${(b / 1_048_576).toFixed(2)} MB`;

const fmtMs = (ms: number) =>
  ms < 1 ? `${ms.toFixed(2)}ms` : ms < 1000 ? `${ms.toFixed(1)}ms` : `${(ms / 1000).toFixed(2)}s`;

function makeText(seed: number, chars: number): string {
  const words = [
    "outline",
    "note",
    "task",
    "idea",
    "project",
    "meeting",
    "review",
    "plan",
    "update",
    "check",
    "important",
    "action",
    "decision",
    "question",
  ];
  const out: string[] = [];
  let len = 0,
    i = seed;
  while (len < chars) {
    const w = words[i++ % words.length];
    out.push(w);
    len += w.length + 1;
  }
  return out.join(" ").slice(0, chars);
}

function _buildTree(
  blockCount: number,
  nestRatio: number,
): { rootIds: OccurrenceId[]; allIds: OccurrenceId[] } {
  const rootCount = Math.ceil(blockCount * (1 - nestRatio));
  return { rootIds: Array.from({ length: rootCount }, (_, i) => `r${i}`), allIds: [] };
}

// ── USER mode ─────────────────────────────────────────────────────────────────

function runUser(blockCount: number, avgChars: number, nestRatio: number) {
  const engine = new Engine();
  const rootCount = Math.ceil(blockCount * (1 - nestRatio));
  const rootIds: OccurrenceId[] = [];
  const allIds: OccurrenceId[] = [];

  const t0 = performance.now();
  for (let i = 0; i < rootCount; i++) {
    const id = engine.createNode().occurrenceId;
    rootIds.push(id);
    allIds.push(id);
  }
  for (let i = rootCount; i < blockCount; i++) {
    allIds.push(engine.createNode(rootIds[i % rootIds.length]).occurrenceId);
  }
  for (let i = 0; i < allIds.length; i++) {
    engine.replaceDeltas(allIds[i], textToDelta(makeText(i, avgChars)));
  }
  const tBuild = performance.now() - t0;

  const snap = engine.exportSnapshot();
  const t1 = performance.now();
  const e2 = new Engine({ store: new ShardedBlockStore({ initialTreeBytes: snap }) });
  const tImport = performance.now() - t1;

  engine.dispose();
  e2.dispose();
  return { tBuild, tImport, snapBytes: snap.length };
}

// ── BATCHED mode ──────────────────────────────────────────────────────────────

function runBatched(blockCount: number, avgChars: number, nestRatio: number) {
  const engine = new Engine();
  const rootCount = Math.ceil(blockCount * (1 - nestRatio));
  const rootIds: OccurrenceId[] = [];
  const allIds: OccurrenceId[] = [];

  const t0 = performance.now();
  engine.transact(() => {
    for (let i = 0; i < rootCount; i++) {
      const id = engine.createNode().occurrenceId;
      rootIds.push(id);
      allIds.push(id);
    }
    for (let i = rootCount; i < blockCount; i++) {
      allIds.push(engine.createNode(rootIds[i % rootIds.length]).occurrenceId);
    }
    for (let i = 0; i < allIds.length; i++) {
      engine.replaceDeltas(allIds[i], textToDelta(makeText(i, avgChars)));
    }
  });
  const tBuild = performance.now() - t0;

  const snap = engine.exportSnapshot();
  const t1 = performance.now();
  new Engine({ store: new ShardedBlockStore({ initialTreeBytes: snap }) });
  const tImport = performance.now() - t1;

  return { tBuild, tImport, snapBytes: snap.length };
}

// ── TYPING mode ───────────────────────────────────────────────────────────────

function runTyping(blockCount: number, avgChars: number, nestRatio: number) {
  const engine = new Engine();
  const rootCount = Math.ceil(blockCount * (1 - nestRatio));
  const rootIds: OccurrenceId[] = [];
  const allIds: OccurrenceId[] = [];

  engine.transact(() => {
    for (let i = 0; i < rootCount; i++) {
      const id = engine.createNode().occurrenceId;
      rootIds.push(id);
      allIds.push(id);
    }
    for (let i = rootCount; i < blockCount; i++) {
      allIds.push(engine.createNode(rootIds[i % rootIds.length]).occurrenceId);
    }
  });

  const t0 = performance.now();
  for (let i = 0; i < allIds.length; i++) {
    const text = makeText(i, avgChars);
    engine.replaceDeltas(allIds[i]!, textToDelta(text));
  }
  const tBuild = performance.now() - t0;

  const snap = engine.exportSnapshot();
  const t1 = performance.now();
  new Engine({ store: new ShardedBlockStore({ initialTreeBytes: snap }) });
  const tImport = performance.now() - t1;

  return { tBuild, tImport, snapBytes: snap.length };
}

// ── Main ──────────────────────────────────────────────────────────────────────

type Row = {
  blocks: number;
  chars: number;
  mode: string;
  tBuild: number;
  tImport: number;
  snapBytes: number;
};

function main() {
  const SEP = "─".repeat(88);
  console.log(`\n${"═".repeat(88)}`);
  console.log(`  Engine Capacity Benchmark   |   Node.js ${process.version}`);
  console.log("═".repeat(88));

  const results: Row[] = [];

  // USER: only small N (each block is a roundtrip to Loro + cache rebuild)
  const userSizes = [100, 500, 2_000];
  // BATCHED: push to large N (bulk import, single commit)
  const batchedSizes = [500, 2_000, 10_000, 50_000];
  // TYPING: medium N (80 char inserts per block, commit per block)
  const typingSizes = [500, 2_000];

  const CHARS = 80;
  const NEST = 0.5;

  console.log("\n  Running...\n");

  for (const n of userSizes) {
    process.stdout.write(`  USER    ${String(n).padStart(6)} blocks ×${CHARS}ch ... `);
    const r = runUser(n, CHARS, NEST);
    results.push({ blocks: n, chars: CHARS, mode: "USER   ", ...r });
    console.log(`build ${fmtMs(r.tBuild).padStart(8)}  snap ${fmt(r.snapBytes)}`);
  }

  for (const n of batchedSizes) {
    process.stdout.write(`  BATCHED ${String(n).padStart(6)} blocks ×${CHARS}ch ... `);
    const r = runBatched(n, CHARS, NEST);
    results.push({ blocks: n, chars: CHARS, mode: "BATCHED", ...r });
    console.log(`build ${fmtMs(r.tBuild).padStart(8)}  snap ${fmt(r.snapBytes)}`);
  }

  for (const n of typingSizes) {
    process.stdout.write(`  TYPING  ${String(n).padStart(6)} blocks ×${CHARS}ch ... `);
    const r = runTyping(n, CHARS, NEST);
    results.push({ blocks: n, chars: CHARS, mode: "TYPING ", ...r });
    console.log(`build ${fmtMs(r.tBuild).padStart(8)}  snap ${fmt(r.snapBytes)}`);
  }

  // ── Summary table ────────────────────────────────────────────────────────────

  console.log(`\n${SEP}`);
  const H = (s: string, w: number) => s.padEnd(w);
  console.log(
    H("Blocks × chars", 22) +
      H("Mode", 10) +
      H("Raw text", 12) +
      H("Snapshot", 12) +
      H("Ratio", 8) +
      H("Build", 10) +
      H("Import", 10),
  );
  console.log(SEP);

  const sorted = [...results].sort((a, b) => a.mode.localeCompare(b.mode) || a.blocks - b.blocks);

  for (const r of sorted) {
    const raw = r.blocks * r.chars;
    console.log(
      H(`${r.blocks.toLocaleString()} × ${r.chars}ch`, 22) +
        H(r.mode, 10) +
        H(fmt(raw), 12) +
        H(fmt(r.snapBytes), 12) +
        H(`${(r.snapBytes / raw).toFixed(2)}x`, 8) +
        H(fmtMs(r.tBuild), 10) +
        H(fmtMs(r.tImport), 10),
    );
  }
  console.log(SEP);

  // ── Extrapolation ─────────────────────────────────────────────────────────────

  const bResults = results.filter((r) => r.mode === "BATCHED");
  const largest = bResults.at(-1);

  console.log("\n── BATCHED mode: per-block cost (bulk import / initial load) ─────────────");
  for (const r of bResults) {
    const µs = ((r.tBuild / r.blocks) * 1000).toFixed(0);
    const bpc = (r.snapBytes / (r.blocks * r.chars)).toFixed(2);
    console.log(
      `  ${String(r.blocks).padStart(7)}: ${fmtMs(r.tBuild).padStart(9)}  (${µs}µs/block)   ${bpc} bytes/char   import ${fmtMs(r.tImport)}`,
    );
  }

  const bpc = largest.snapBytes / (largest.blocks * largest.chars);
  const importRate = largest.tImport / largest.snapBytes; // ms per byte

  console.log("\n── Extrapolation from BATCHED (import path = how app loads at startup) ────");
  for (const scenario of [
    { label: "Light user    5yr  (20k blocks)", n: 20_000 },
    { label: "Heavy user    5yr (100k blocks)", n: 100_000 },
    { label: "Extreme user 10yr (300k blocks)", n: 300_000 },
  ]) {
    const rawText = scenario.n * CHARS;
    const snap = rawText * bpc;
    const importMs = snap * importRate;
    console.log(
      `  ${scenario.label}:  raw ${fmt(rawText).padStart(8)}  snap ~${fmt(snap).padStart(9)}  import ~${fmtMs(importMs)}`,
    );
  }

  const tResults = results.filter((r) => r.mode === "TYPING ");
  if (tResults.length >= 1) {
    const lt = tResults.at(-1);
    const tBpc = lt.snapBytes / (lt.blocks * lt.chars);
    const tImportRate = lt.tImport / lt.snapBytes;

    console.log("\n── TYPING mode (keystroke-by-keystroke over document lifetime) ──────────");
    for (const scenario of [
      { label: "Light user    5yr  (20k blocks)", n: 20_000 },
      { label: "Heavy user    5yr (100k blocks)", n: 100_000 },
      { label: "Extreme user 10yr (300k blocks)", n: 300_000 },
    ]) {
      const rawText = scenario.n * CHARS;
      const snap = rawText * tBpc;
      const importMs = snap * tImportRate;
      console.log(
        `  ${scenario.label}:  raw ${fmt(rawText).padStart(8)}  snap ~${fmt(snap).padStart(9)}  import ~${fmtMs(importMs)}`,
      );
    }
    const ratio = lt.snapBytes / bResults.find((r) => r.blocks === lt.blocks)!.snapBytes;
    console.log(
      `\n  Snapshot size: TYPING is ${ratio.toFixed(2)}x BATCHED (Loro columnar encoding is efficient)`,
    );
  }

  // USER mode scaling analysis
  const uResults = results.filter((r) => r.mode === "USER   ");
  if (uResults.length >= 2) {
    console.log("\n── USER mode scaling (individual ops, engine cache overhead) ────────────");
    for (const r of uResults) {
      const µs = ((r.tBuild / r.blocks) * 1000).toFixed(0);
      console.log(
        `  ${String(r.blocks).padStart(6)} blocks: ${fmtMs(r.tBuild).padStart(9)}  (${µs}µs/block)`,
      );
    }
    const u0 = uResults[0],
      u1 = uResults.at(-1);
    const nRatio = u1.blocks / u0.blocks;
    const tRatio = u1.tBuild / u0.tBuild;
    const exp = Math.log(tRatio) / Math.log(nRatio);
    console.log(`  Scaling exponent: O(N^${exp.toFixed(2)})  [ideal linear = O(N^1.00)]`);
    console.log(`  Note: engine.batch() would make bulk operations O(N) like BATCHED mode`);
  }

  console.log("\n");
}

main();
