import { describe, expect, it } from "vitest";
import { SCALE_MATRIX, runWorker } from "../bench/scale.js";

/**
 * #2 — evidence at realistic scale + a complexity argument against blowup.
 *
 * Correctness suites run on tiny trees by design (the algorithms are
 * scale-invariant). This answers the orthogonal questions: does the engine hold
 * up at production-ish scale (10k+), converge across replicas, and scale ~LINEARLY
 * (no hidden O(n²))?
 *
 * Each scenario runs in a FRESH CHILD PROCESS (see bench/scale.ts): loro-crdt is
 * WASM-backed and does not return its arena after free, so running many large
 * docs in one vitest fork accumulates memory until it aborts. A child per
 * scenario dies before the next (hard rule: one workload at a time).
 *
 * The same scenarios can be run standalone to regenerate scale-results.md:
 *   node --import tsx --expose-gc experiments/multi-shard-tree/bench/scale.ts
 */
describe("scale (child-process isolated): 10k+ build/converge + linear complexity", () => {
  for (const m of SCALE_MATRIX) {
    it(`${m.name} ${m.args.join(" ") || ""} passes`, () => {
      const res = runWorker(m.name, m.args);
      if (!res.ok) throw new Error(res.error ?? `${m.name} failed without error`);
      // eslint-disable-next-line no-console
      console.log(`[scale] ${m.name} ${m.args.join(" ")} -> ${JSON.stringify(res.detail)}`);
    });
  }

  it("the scale matrix is non-trivial (covers single/multi/refdensity/partition/complexity)", () => {
    const names = SCALE_MATRIX.map((m) => m.name).sort();
    expect(names).toEqual(["complexity", "multi", "partition", "refdensity", "single"]);
  });
});
