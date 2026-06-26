// bench/scale.ts — Tier 2 scale + complexity evidence, one workload per fresh
// child process (loro-crdt's WASM arena is not returned to the OS after free,
// so running many large docs in one process accumulates memory until it aborts).
//
//   node --import tsx --expose-gc --max-old-space-size=4096 \
//        experiments/multi-shard-tree/bench/scale.ts            # writes scale-results.md
//
// vitest drives the same scenarios as children (always-on) via test/scale.test.ts.

import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { ShardedEngine } from "../src/sharded-engine.js";
import { canonicalStructure, stableStringify } from "../src/compare.js";
import { cloneReplica, syncAll } from "../src/simulator.js";

const SELF = fileURLToPath(import.meta.url);
const HERE = dirname(SELF);
const gc = (): void => globalThis.gc?.();
const now = (): number => performance.now();
const freeAll = (e: ShardedEngine): void => {
  for (const d of e.syncDocs()) d.free?.();
  gc();
};
const canon = (e: ShardedEngine, nodeId: string): string => {
  const id = e.snapshot().nodes[nodeId]?.canonicalOccurrenceId;
  if (!id) throw new Error(`no canonical for ${nodeId}`);
  return id;
};
function buildWide(e: ShardedEngine, n: number, prefix = "n"): string {
  const root = e.createNode("root", null, undefined, "root");
  for (let i = 0; i < n; i++) e.createNode(`${prefix}${i}`, root, undefined, `node ${i}`);
  e.commit();
  return root;
}
const equivAll = (reps: ShardedEngine[]): void => {
  for (const e of reps) e.validateInvariants();
  const base = stableStringify(canonicalStructure(reps[0]!.snapshot()));
  for (const e of reps) {
    if (stableStringify(canonicalStructure(e.snapshot())) !== base) {
      throw new Error("replicas did not converge");
    }
  }
};

// ── scenarios (each throws on failure, returns a summary) ─────────────────────
type Result = { ok: true; detail: Record<string, unknown> };
const ok = (detail: Record<string, unknown>): Result => ({ ok: true, detail });

function scSingle(n: number): Result {
  const e = new ShardedEngine(8);
  buildWide(e, n);
  e.validateInvariants();
  const nodes = Object.keys(e.snapshot().nodes).length;
  if (nodes !== n + 1) throw new Error(`expected ${n + 1} nodes, got ${nodes}`);
  freeAll(e);
  return ok({ n, nodes });
}

function scMulti(perReplica: number, replicas: number): Result {
  const reps: ShardedEngine[] = [];
  for (let r = 0; r < replicas; r++) {
    const e = new ShardedEngine(8);
    buildWide(e, perReplica, `r${r}`);
    reps.push(e);
  }
  syncAll(reps);
  equivAll(reps);
  const live = reps[0]!.liveNodeIds().length;
  const expected = perReplica * replicas + 1; // each replica's nodes + shared root
  if (live !== expected) throw new Error(`expected ${expected} live nodes, got ${live}`);
  for (const e of reps) freeAll(e);
  return ok({ perReplica, replicas, live });
}

function scRefDensity(nodes: number, refsPerReplica: number): Result {
  const seed = new ShardedEngine(8);
  const root = seed.createNode("root", null);
  for (let i = 0; i < nodes; i++) seed.createNode(`n${i}`, root, undefined, `n${i}`);
  seed.commit();
  const a = cloneReplica(seed);
  const b = cloneReplica(seed);
  for (let i = 0; i < refsPerReplica; i++)
    a.createReference(`n${i % (nodes / 2)}`, canon(a, "root"));
  for (let i = 0; i < refsPerReplica; i++)
    b.createReference(`n${i % (nodes / 2)}`, canon(b, "root"));
  a.commit();
  b.commit();
  syncAll([a, b]);
  equivAll([a, b]);
  freeAll(a);
  freeAll(b);
  freeAll(seed);
  return ok({ nodes, refsPerReplica });
}

function scPartition(ops: number): Result {
  const seed = new ShardedEngine(8);
  const root = seed.createNode("root", null);
  seed.createNode("shared", root, undefined, "S");
  seed.commit();
  const a = cloneReplica(seed);
  const b = cloneReplica(seed);
  const ar = canon(a, "root");
  const br = canon(b, "root");
  for (let i = 0; i < ops; i++) {
    a.createNode(`a${i}`, ar, undefined, `A${i}`);
    b.createNode(`b${i}`, br, undefined, `B${i}`);
    if (i % 10 === 0) a.setText("shared", `a${i}`);
    if (i % 7 === 0) b.setText("shared", `b${i}`);
  }
  a.commit();
  b.commit();
  syncAll([a, b]);
  equivAll([a, b]);
  if (!a.snapshot().nodes[`a0`] || !a.snapshot().nodes[`b${ops - 1}`]) {
    throw new Error("partition merge lost nodes");
  }
  freeAll(a);
  freeAll(b);
  freeAll(seed);
  return ok({ ops });
}

function scComplexityPoint(n: number): Result {
  const e = new ShardedEngine(8);
  const b0 = now();
  buildWide(e, n);
  const build = now() - b0;
  const s0 = now();
  e.snapshot();
  const snap = now() - s0;
  // 20 deletes — timed per-delete. NOTE: each hardDelete re-scans the whole tree
  // (no nodeId→occurrence index), so this is O(deletes·N), surfaced on purpose.
  const dels = Math.min(20, n);
  const d0 = now();
  for (let i = 0; i < dels; i++) e.hardDeleteNode(`n${(i * 7) % n}`);
  e.commit();
  const del = (now() - d0) / dels;
  const w0 = now();
  e.sweepTombstones();
  const sweep = now() - w0;
  freeAll(e);
  return ok({ n, build, snap, delPerNode: del, sweep });
}

// Forks one child per N. ASSERTS the core ops (build, snapshot) are ~linear;
// REPORTS delete/sweep scaling as a known finding (bulk delete is O(deletes·N)
// — a production engine adds a nodeId→occurrence index to make it O(deletes)).
function scComplexitySlope(): Result {
  const TOLERANCE = 2.5;
  const NS = [1_000, 5_000, 10_000, 50_000];
  const pts = NS.map((n) => {
    const r = runWorker("complexity-n", [String(n)]);
    if (!r.ok || !r.detail) throw new Error(`complexity-n ${n} failed: ${JSON.stringify(r)}`);
    return r.detail as { build: number; snap: number; delPerNode: number; sweep: number };
  });
  const sizeRatio = NS[NS.length - 1]! / NS[0]!;
  const slope = (k: "build" | "snap"): number => pts[pts.length - 1]![k] / pts[0]![k];
  for (const k of ["build", "snap"] as const) {
    if (slope(k) > TOLERANCE * sizeRatio) {
      throw new Error(
        `${k} slope ${slope(k).toFixed(1)}x exceeds ${TOLERANCE}x linear (${sizeRatio}x)`,
      );
    }
  }
  return ok({
    NS: NS.join("/"),
    sizeRatio,
    buildSlope: slope("build"),
    snapSlope: slope("snap"),
    // Reported, not asserted linear (see note above):
    delPerNodeMs: pts.map((p) => p.delPerNode.toFixed(1)).join("→"),
    sweepMs: pts.map((p) => p.sweep.toFixed(0)).join("→"),
  });
}

const SCENARIOS: Record<string, (args: string[]) => Result> = {
  single: (a) => scSingle(Number(a[0])),
  multi: (a) => scMulti(Number(a[0]), Number(a[1])),
  refdensity: (a) => scRefDensity(Number(a[0]), Number(a[1])),
  partition: (a) => scPartition(Number(a[0])),
  complexity: () => scComplexitySlope(),
  "complexity-n": (a) => scComplexityPoint(Number(a[0])),
};

// The canonical scale matrix run by main() and by test/scale.test.ts.
const MATRIX: { name: string; args: string[] }[] = [
  { name: "single", args: ["10000"] },
  { name: "multi", args: ["10000", "2"] },
  { name: "refdensity", args: ["500", "1000"] },
  { name: "partition", args: ["1000"] },
  { name: "complexity", args: [] },
];

/** Run one scenario in a fresh child process; returns {ok} (+ detail/error). */
export function runWorker(
  name: string,
  args: string[],
): { ok: boolean; detail?: unknown; error?: string } {
  const r = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--expose-gc",
      "--max-old-space-size=4096",
      SELF,
      "--worker",
      name,
      ...args,
    ],
    { encoding: "utf8", timeout: 300_000 },
  );
  if (r.status !== 0) {
    return { ok: false, error: (r.stderr ?? "").slice(-800) || `exit ${r.status}` };
  }
  try {
    return JSON.parse(r.stdout.trim()) as { ok: boolean; detail?: unknown };
  } catch {
    return { ok: false, error: `unparseable output: ${r.stdout.slice(-200)}` };
  }
}

export const SCALE_MATRIX = MATRIX;

function main(): void {
  const lines: string[] = ["# scale-results — Tier 2 scale + complexity", ""];
  const log = (s: string): void => {
    // eslint-disable-next-line no-console
    console.log(s);
    lines.push(s);
  };
  log(
    "_one fresh child process per scenario (WASM arena isolation), " +
      new Date().toISOString().slice(0, 10) +
      "_",
  );
  log("");
  log("| scenario | args | result | detail |");
  log("|----------|------|--------|--------|");
  let allOk = true;
  for (const m of MATRIX) {
    const res = runWorker(m.name, m.args);
    allOk = allOk && res.ok;
    log(
      "| " +
        m.name +
        " | " +
        (m.args.join(" ") || "—") +
        " | " +
        (res.ok ? "✅" : "❌") +
        " | " +
        (res.ok ? JSON.stringify(res.detail) : String(res.error).slice(0, 120)) +
        " |",
    );
  }
  writeFileSync(join(HERE, "scale-results.md"), lines.join("\n") + "\n");
  // eslint-disable-next-line no-console
  console.log(
    "\n=> wrote " +
      join(HERE, "scale-results.md") +
      (allOk ? " (all scenarios ok)" : " (SOME FAILED)"),
  );
  if (!allOk) process.exitCode = 1;
}

const isEntry = !!process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (process.argv[2] === "--worker") {
  const name = process.argv[3]!;
  const args = process.argv.slice(4);
  const fn = SCENARIOS[name];
  if (!fn) throw new Error("unknown scenario: " + name);
  // scenario throws on failure; only reaches here on success.
  process.stdout.write(JSON.stringify(fn(args)));
} else if (isEntry) {
  main();
}
