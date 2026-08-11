import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { LoroDoc } from "loro-crdt";
import {
  FactFirstAuthority,
  StateReviewAuthority,
  contribution,
  resolution,
  type Fact,
} from "./authority-model.js";

type Candidate = "fact-first" | "state-review";

type BenchmarkRow = {
  candidate: Candidate;
  nodes: number;
  facts: number;
  startupMs: number;
  fullReviewMs: number;
  incrementalMicros: number;
  storageMiB: number;
  gzipMiB: number;
  compactedMiB: number;
  compactedStartupMs: number;
  sync500KiB: number;
  heapMiB: number;
  writesPerFact: number;
};

const SIZES = [1_000, 10_000, 20_000];
const MiB = 1024 * 1024;

function workload(nodeCount: number): Fact[] {
  const facts: Fact[] = [];
  let counter = 0;
  for (let index = 0; index < nodeCount; index += 1) {
    const nodeId = `n-${index}`;
    const occurrenceId = `o-${index}`;
    const parentOccurrenceId = index === 0 ? null : `o-${Math.floor((index - 1) / 8)}`;
    facts.push(
      contribution(`create-${index}`, ++counter, "seed", "direct", {
        type: "create-node",
        nodeId,
      }),
      contribution(`occurrence-${index}`, ++counter, "seed", "direct", {
        type: "create-occurrence",
        occurrenceId,
        nodeId,
        parentOccurrenceId,
        canonical: true,
      }),
      contribution(`text-${index}`, ++counter, "seed", "direct", {
        type: "set-text",
        nodeId,
        value: `Node ${index}: representative workspace content`,
      }),
      contribution(`property-${index}`, ++counter, "seed", "direct", {
        type: "set-property",
        nodeId,
        key: "status",
        value: index % 3 === 0 ? "active" : "open",
      }),
    );
    if (index % 20 === 0) {
      const proposalId = `proposal-${index}`;
      facts.push(
        contribution(proposalId, ++counter, `author-${index % 7}`, "proposal", {
          type: "set-property",
          nodeId,
          key: "priority",
          value: index % 5,
        }),
        resolution(
          `resolution-${index}`,
          ++counter,
          `reviewer-${index % 5}`,
          proposalId,
          index % 40 === 0 ? "accept" : "reject",
        ),
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

function createCandidate(
  candidate: Candidate,
  facts: readonly Fact[],
): FactFirstAuthority | StateReviewAuthority {
  if (candidate === "fact-first") {
    const model = new FactFirstAuthority();
    model.ingestAll(facts);
    return model;
  }
  const model = new StateReviewAuthority();
  model.ingestAll(facts);
  return model;
}

function isolatedHeapBytes(candidate: Candidate, nodeCount: number): number {
  const result = spawnSync(
    process.execPath,
    [
      "--expose-gc",
      "node_modules/tsx/dist/cli.mjs",
      resolve(process.argv[1] ?? "experiments/proposal-authority-model/benchmark.ts"),
      "--memory-case",
      candidate,
      String(nodeCount),
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || `memory child exited with ${result.status}`);
  }
  const bytes = Number(result.stdout.trim());
  if (!Number.isFinite(bytes)) throw new Error(`invalid memory result: ${result.stdout}`);
  return bytes;
}

function loroRecordBytes(records: readonly Fact[]): number {
  const doc = new LoroDoc();
  const map = doc.getMap("records");
  for (const fact of records) map.set(fact.id, JSON.stringify(fact));
  doc.commit();
  return doc.export({ mode: "snapshot" }).byteLength;
}

function syncBytesForTail(candidate: Candidate, facts: readonly Fact[]): number {
  const tail = facts.slice(-500);
  if (candidate === "fact-first") return loroRecordBytes(tail);
  const latestDecision = new Map<string, "accept" | "reject">();
  for (const fact of facts) {
    if (fact.kind === "resolution") latestDecision.set(fact.proposalId, fact.decision);
  }
  const originUpdates = tail.filter(
    (fact) =>
      fact.kind === "contribution" &&
      (fact.intent === "direct" || latestDecision.get(fact.id) === "accept"),
  );
  return loroRecordBytes(tail) + loroRecordBytes(originUpdates);
}

function runCandidate(
  candidate: Candidate,
  nodeCount: number,
  facts: readonly Fact[],
): BenchmarkRow {
  const model = createCandidate(candidate, facts);
  const serialized = model.serialize();
  const hydrate = (): FactFirstAuthority | StateReviewAuthority =>
    candidate === "fact-first"
      ? FactFirstAuthority.hydrate(serialized)
      : StateReviewAuthority.hydrate(serialized);

  const startupMs = median(
    Array.from({ length: 5 }, () =>
      elapsedMs(() => {
        const restarted = hydrate();
        restarted.origin();
      }),
    ),
  );
  const fullReviewMs = median(
    Array.from({ length: 5 }, () =>
      elapsedMs(() => {
        if (model instanceof FactFirstAuthority) {
          model.rebuildProjection("review");
        } else {
          model.review();
        }
      }),
    ),
  );

  const incrementalModel = hydrate();
  const updateCount = 500;
  const incrementalFacts = Array.from({ length: updateCount }, (_, index) =>
    contribution(
      `incremental-${nodeCount}-${index}`,
      facts.length + index + 1,
      "benchmark",
      "direct",
      {
        type: "set-text",
        nodeId: `n-${index % nodeCount}`,
        value: `Incremental value ${index}`,
      },
    ),
  );
  const incrementalMs = elapsedMs(() => {
    for (const fact of incrementalFacts) incrementalModel.ingest(fact);
  });

  const compacted = hydrate();
  compacted.compact(true);
  const compactedSerialized = compacted.serialize();
  const compactedStartupMs = median(
    Array.from({ length: 5 }, () =>
      elapsedMs(() => {
        const restarted =
          candidate === "fact-first"
            ? FactFirstAuthority.hydrate(compactedSerialized)
            : StateReviewAuthority.hydrate(compactedSerialized);
        restarted.origin();
      }),
    ),
  );
  const syncBytes = syncBytesForTail(candidate, facts);
  const heapBytes = isolatedHeapBytes(candidate, nodeCount);
  const stats = model.stats();

  return {
    candidate,
    nodes: nodeCount,
    facts: facts.length,
    startupMs,
    fullReviewMs,
    incrementalMicros: (incrementalMs * 1_000) / updateCount,
    storageMiB: serialized.length / MiB,
    gzipMiB: gzipSync(serialized).byteLength / MiB,
    compactedMiB: compactedSerialized.length / MiB,
    compactedStartupMs,
    sync500KiB: syncBytes / 1024,
    heapMiB: heapBytes / MiB,
    writesPerFact: stats.durableWrites / facts.length,
  };
}

function fixed(value: number, digits = 2): string {
  return value.toFixed(digits);
}

function printMarkdown(rows: readonly BenchmarkRow[]): void {
  process.stdout.write(
    [
      "| Candidate | Nodes | Facts | Startup ms | Full Review ms | Incremental µs/fact | Storage MiB | gzip MiB | Compacted MiB | Compacted startup ms | Loro sync 500 KiB | Heap MiB | Durable writes/fact |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...rows.map(
        (row) =>
          `| ${row.candidate} | ${row.nodes} | ${row.facts} | ${fixed(row.startupMs)} | ${fixed(row.fullReviewMs)} | ${fixed(row.incrementalMicros)} | ${fixed(row.storageMiB)} | ${fixed(row.gzipMiB)} | ${fixed(row.compactedMiB)} | ${fixed(row.compactedStartupMs)} | ${fixed(row.sync500KiB)} | ${fixed(row.heapMiB)} | ${fixed(row.writesPerFact)} |`,
      ),
      "",
      `Node ${process.version}; ${process.platform} ${process.arch}; synthetic 8-way outline tree; Proposal on 5% of Nodes; 500-fact sync tail.`,
    ].join("\n"),
  );
}

function runMemoryCase(candidate: Candidate, nodeCount: number): void {
  let facts = workload(nodeCount);
  const encodedFacts = JSON.stringify(facts);
  facts = [];
  collectGarbage();
  const before = process.memoryUsage().heapUsed;
  let parsed = JSON.parse(encodedFacts) as Fact[];
  const model = createCandidate(candidate, parsed);
  parsed = [];
  model.origin();
  model.review();
  collectGarbage();
  const after = process.memoryUsage().heapUsed;
  process.stdout.write(String(Math.max(0, after - before)));
}

function main(): void {
  const rows: BenchmarkRow[] = [];
  for (const nodeCount of SIZES) {
    const facts = workload(nodeCount);
    for (const candidate of ["fact-first", "state-review"] as const) {
      rows.push(runCandidate(candidate, nodeCount, facts));
    }
  }
  printMarkdown(rows);
}

if (process.argv[2] === "--memory-case") {
  const candidate = process.argv[3];
  const nodeCount = Number(process.argv[4]);
  if ((candidate !== "fact-first" && candidate !== "state-review") || !nodeCount) {
    throw new Error("invalid memory case");
  }
  runMemoryCase(candidate, nodeCount);
} else {
  main();
}
