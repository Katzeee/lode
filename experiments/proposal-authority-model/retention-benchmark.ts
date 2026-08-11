import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { FactFirstAuthority, contribution, type Fact } from "./authority-model.js";

type RetentionRow = {
  editsPerNode: number;
  facts: number;
  historyMiB: number;
  historyGzipMiB: number;
  startupMs: number;
  fullReviewMs: number;
  compactedMiB: number;
  compactedGzipMiB: number;
  compactedStartupMs: number;
  retainedHeapMiB: number;
};

const NODE_COUNT = 5_000;
const EDIT_COUNTS = [0, 10, 50, 100];
const MiB = 1024 * 1024;

function workload(editsPerNode: number): Fact[] {
  const facts: Fact[] = [];
  let counter = 0;
  for (let index = 0; index < NODE_COUNT; index += 1) {
    const nodeId = `n-${index}`;
    facts.push(
      contribution(`create-${index}`, ++counter, "seed", "direct", {
        type: "create-node",
        nodeId,
      }),
      contribution(`occurrence-${index}`, ++counter, "seed", "direct", {
        type: "create-occurrence",
        occurrenceId: `o-${index}`,
        nodeId,
        parentOccurrenceId: index === 0 ? null : `o-${Math.floor((index - 1) / 8)}`,
        canonical: true,
      }),
      contribution(`text-${index}`, ++counter, "seed", "direct", {
        type: "set-text",
        nodeId,
        value: `Stable current content for Node ${index}`,
      }),
      contribution(`initial-property-${index}`, ++counter, "seed", "direct", {
        type: "set-property",
        nodeId,
        key: "counter",
        value: 0,
      }),
    );
  }
  for (let edit = 1; edit <= editsPerNode; edit += 1) {
    for (let index = 0; index < NODE_COUNT; index += 1) {
      facts.push(
        contribution(`edit-${edit}-${index}`, ++counter, `actor-${edit % 7}`, "direct", {
          type: "set-property",
          nodeId: `n-${index}`,
          key: "counter",
          value: edit,
        }),
      );
    }
  }
  return facts;
}

function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function elapsedMs(run: () => void): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

function collectGarbage(): void {
  global.gc?.();
}

function runCase(editsPerNode: number): RetentionRow {
  collectGarbage();
  const baselineHeap = process.memoryUsage().heapUsed;
  let facts = workload(editsPerNode);
  const factCount = facts.length;
  const model = new FactFirstAuthority();
  model.ingestAll(facts);
  facts = [];
  collectGarbage();
  const retainedHeapMiB = Math.max(0, process.memoryUsage().heapUsed - baselineHeap) / MiB;

  const serialized = model.serialize();
  const startupMs = median(
    Array.from({ length: 3 }, () =>
      elapsedMs(() => {
        const restarted = FactFirstAuthority.hydrate(serialized);
        restarted.origin();
      }),
    ),
  );
  const fullReviewMs = median(
    Array.from({ length: 3 }, () =>
      elapsedMs(() => {
        model.rebuildProjection("review");
      }),
    ),
  );

  const compacted = FactFirstAuthority.hydrate(serialized);
  compacted.compact(true);
  const compactedSerialized = compacted.serialize();
  const compactedStartupMs = median(
    Array.from({ length: 3 }, () =>
      elapsedMs(() => {
        const restarted = FactFirstAuthority.hydrate(compactedSerialized);
        restarted.origin();
      }),
    ),
  );

  return {
    editsPerNode,
    facts: factCount,
    historyMiB: serialized.length / MiB,
    historyGzipMiB: gzipSync(serialized).byteLength / MiB,
    startupMs,
    fullReviewMs,
    compactedMiB: compactedSerialized.length / MiB,
    compactedGzipMiB: gzipSync(compactedSerialized).byteLength / MiB,
    compactedStartupMs,
    retainedHeapMiB,
  };
}

function childCase(editsPerNode: number): RetentionRow {
  const result = spawnSync(
    process.execPath,
    [
      "--expose-gc",
      "node_modules/tsx/dist/cli.mjs",
      resolve(process.argv[1] ?? "experiments/proposal-authority-model/retention-benchmark.ts"),
      "--case",
      String(editsPerNode),
    ],
    { cwd: process.cwd(), encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || `retention child exited with ${result.status}`);
  }
  return JSON.parse(result.stdout) as RetentionRow;
}

function fixed(value: number): string {
  return value.toFixed(2);
}

function main(): void {
  const rows = EDIT_COUNTS.map(childCase);
  process.stdout.write(
    [
      "| Edits/Node | Facts | Retained MiB | gzip MiB | Startup ms | Full Review ms | Checkpoint MiB | Checkpoint gzip MiB | Checkpoint startup ms | Retained heap MiB |",
      "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...rows.map(
        (row) =>
          `| ${row.editsPerNode} | ${row.facts} | ${fixed(row.historyMiB)} | ${fixed(row.historyGzipMiB)} | ${fixed(row.startupMs)} | ${fixed(row.fullReviewMs)} | ${fixed(row.compactedMiB)} | ${fixed(row.compactedGzipMiB)} | ${fixed(row.compactedStartupMs)} | ${fixed(row.retainedHeapMiB)} |`,
      ),
      "",
      `Node ${process.version}; ${process.platform} ${process.arch}; fixed ${NODE_COUNT}-Node workspace; Direct property churn only; three-sample medians.`,
    ].join("\n"),
  );
}

if (process.argv[2] === "--case") {
  const editsPerNode = Number(process.argv[3]);
  process.stdout.write(JSON.stringify(runCase(editsPerNode)));
} else {
  main();
}
