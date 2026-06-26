import { describe, expect, it } from "vitest";
import { ShardedEngine } from "../src/sharded-engine.js";
import { SingleDocEngine } from "../src/single-doc-engine.js";

/**
 * #1 (regression half) — the always-on guard that the sharding win does not
 * silently regress. Two properties, small N (10k) so it is cheap to run in CI:
 *
 *   - the tree-doc-only snapshot is materially smaller than the full single-doc
 *     snapshot (ratio < 0.5). Snapshot BYTES are exact and deterministic — no GC
 *     gymnastics needed — so this is the stable anchor.
 *   - cold-loading the tree-doc-only snapshot is faster than cold-loading the
 *     full snapshot (the lazy-load cold-start win).
 *
 * The big-N sizing + RSS + sync-bytes + lazy-read numbers live in bench/run.ts
 * (standalone, --expose-gc) and are recorded in bench/bench-results.md.
 */

const N = 10_000;
const CONTENT = "node content here!!"; // ~20 chars

function buildWide(e: ShardedEngine | SingleDocEngine, n: number): void {
  const root = e.createNode("root", null, undefined, "root node here!!!!");
  for (let i = 0; i < n; i++) e.createNode(`n${i}`, root, undefined, `${CONTENT}${i}`.slice(0, 20));
  e.commit();
}

const freeAll = (docs: { free?: () => void }[]): void => {
  for (const d of docs) d.free?.();
  globalThis.gc?.();
};

describe("bench regression: treeDoc materially smaller + faster to cold-load than full", () => {
  it("treeDoc/full snapshot-byte ratio < 0.5 at N=10k", () => {
    const full = new SingleDocEngine();
    buildWide(full, N);
    const fullBytes = full.exportSnapshotBytes().length;

    const sharded = new ShardedEngine(8);
    buildWide(sharded, N);
    const treeBytes = sharded.treeDoc.export({ mode: "snapshot" }).length;
    const ratio = treeBytes / fullBytes;

    // eslint-disable-next-line no-console
    console.log(
      `[bench] N=${N} full=${fullBytes}B (${(fullBytes / N).toFixed(1)}B/node) ` +
        `treeDoc=${treeBytes}B (${(treeBytes / N).toFixed(1)}B/node) ratio=${ratio.toFixed(3)}`,
    );

    expect(ratio).toBeLessThan(0.5);

    freeAll([full, ...sharded.syncDocs()]);
  });

  it("cold treeDoc-only load is faster than cold full load (median of 9 trials, 1 warmup)", () => {
    const full = new SingleDocEngine();
    buildWide(full, N);
    const fullBytes = full.exportSnapshotBytes();

    const sharded = new ShardedEngine(8);
    buildWide(sharded, N);
    const treeBytes = sharded.treeDoc.export({ mode: "snapshot" });

    const median = (xs: number[]): number => {
      const s = [...xs].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)]!;
    };
    const fullTimes: number[] = [];
    const treeTimes: number[] = [];
    const trials = 10;
    for (let i = 0; i < trials; i++) {
      const f0 = performance.now();
      const f = new SingleDocEngine(fullBytes);
      fullTimes.push(performance.now() - f0);
      f.free();

      const t0 = performance.now();
      const s = new ShardedEngine(8, treeBytes);
      treeTimes.push(performance.now() - t0);
      for (const d of s.syncDocs()) d.free?.();
    }
    globalThis.gc?.();

    const fullMed = median(fullTimes.slice(1)); // drop warmup
    const treeMed = median(treeTimes.slice(1));
    // eslint-disable-next-line no-console
    console.log(
      `[bench] cold-load median full=${fullMed.toFixed(2)}ms treeDoc=${treeMed.toFixed(2)}ms ` +
        `(tree/full=${(treeMed / fullMed).toFixed(3)})`,
    );

    expect(treeMed).toBeLessThan(fullMed);

    freeAll([full, ...sharded.syncDocs()]);
  });
});
