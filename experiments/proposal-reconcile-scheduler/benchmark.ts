import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import {
  LoroFactStore,
  contribution,
  encodeSchedulerCheckpoint,
  resolution,
  schedulerCandidates,
  type Fact,
  type FactSnapshot,
  type ReconcileScheduler,
  type SchedulerCheckpoint,
} from "./reconcile-model.js";

type Measurement = {
  candidate: string;
  nodes: number;
  facts: number;
  startupMs: number;
  fullRebuildMs: number;
  tailReplayUsPerFact: number;
  directAppendUs: number;
  resolutionMs: number;
  checkpointMiB: number;
  retainedHeapMiB: number;
  directAppendEvaluations: number;
};

declare global {
  var proposalSchedulerRetained: unknown;
}

function workspaceFacts(nodeCount: number): Fact[] {
  const facts: Fact[] = [];
  let counter = 0;
  const next = (): number => {
    counter += 1;
    return counter;
  };
  for (let index = 0; index < nodeCount; index += 1) {
    const nodeId = `n-${index}`;
    const occurrenceId = `o-${index}`;
    facts.push(
      contribution(`d-node-${index}`, next(), "seed", "direct", {
        type: "create-node",
        nodeId,
      }),
      contribution(`d-occurrence-${index}`, next(), "seed", "direct", {
        type: "create-occurrence",
        occurrenceId,
        nodeId,
        parentOccurrenceId: index === 0 ? null : "o-0",
        position: String(index).padStart(8, "0"),
        canonical: true,
      }),
      contribution(`d-text-${index}`, next(), "seed", "direct", {
        type: "set-text",
        nodeId,
        value: `Node ${index}`,
      }),
      contribution(`d-property-${index}`, next(), "seed", "direct", {
        type: "set-property",
        nodeId,
        key: "rank",
        value: index,
      }),
    );
    if (index % 10 === 0) {
      facts.push(
        contribution(`d-schema-${index}`, next(), "seed", "direct", {
          type: "apply-schema",
          nodeId,
          schemaId: "task",
          managedFields: ["status", "owner"],
        }),
      );
    }
    if (index % 5 === 0) {
      facts.push(
        contribution(`p-text-${index}`, next(), "author", "proposal", {
          type: "set-text",
          nodeId,
          value: `Proposal ${index}`,
        }),
      );
    }
  }
  return facts;
}

function snapshotOf(facts: readonly Fact[]): FactSnapshot {
  const store = new LoroFactStore();
  store.appendAll(facts);
  return store.snapshot();
}

function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function timed<T>(run: () => T): { elapsedMs: number; value: T } {
  const start = performance.now();
  const value = run();
  return { elapsedMs: performance.now() - start, value };
}

function measureStartup(scheduler: ReconcileScheduler, snapshot: FactSnapshot): number {
  const samples: number[] = [];
  for (let iteration = 0; iteration < 7; iteration += 1) {
    samples.push(
      timed(() => {
        scheduler.rebuild(snapshot, "origin");
        scheduler.rebuild(snapshot, "review");
      }).elapsedMs,
    );
  }
  return median(samples);
}

function measureTail(
  scheduler: ReconcileScheduler,
  baseFacts: readonly Fact[],
  baseSnapshot: FactSnapshot,
): {
  tailReplayUsPerFact: number;
  directAppendUs: number;
  resolutionMs: number;
  directAppendEvaluations: number;
  finalSnapshot: FactSnapshot;
  checkpoint: SchedulerCheckpoint;
} {
  const store = new LoroFactStore();
  store.appendAll(baseFacts);
  let checkpoint = scheduler.rebuild(baseSnapshot, "origin").checkpoint;
  const tailSamples: number[] = [];
  let directAppendEvaluations = 0;
  for (let index = 0; index < 100; index += 1) {
    const fact = contribution(`tail-property-${index}`, 1_000_000 + index, "tail", "direct", {
      type: "set-property",
      nodeId: `n-${index % Math.max(1, Math.floor(baseFacts.length / 5))}`,
      key: "tail",
      value: index,
    });
    store.append(fact);
    const snapshot = store.snapshot();
    const measured = timed(() => scheduler.advance(checkpoint, snapshot));
    checkpoint = measured.value.checkpoint;
    directAppendEvaluations = measured.value.stats.evaluations;
    tailSamples.push(measured.elapsedMs);
  }
  const directAppendUs = median(tailSamples) * 1_000;

  const bulkTail: Fact[] = [];
  for (let index = 0; index < 200; index += 1) {
    bulkTail.push(
      contribution(`bulk-text-${index}`, 1_100_000 + index, "tail", "direct", {
        type: "set-text",
        nodeId: `n-${index}`,
        value: `Tail ${index}`,
      }),
    );
  }
  store.appendAll(bulkTail);
  const bulkSnapshot = store.snapshot();
  const bulkMeasured = timed(() => scheduler.advance(checkpoint, bulkSnapshot));
  checkpoint = bulkMeasured.value.checkpoint;

  const resolutions: Fact[] = [];
  for (let index = 0; index < 100; index += 1) {
    resolutions.push(
      resolution(
        `resolution-${index}`,
        1_200_000 + index,
        "reviewer",
        [`p-text-${index * 5}`],
        index % 2 === 0 ? "accept" : "reject",
      ),
    );
  }
  store.appendAll(resolutions);
  const finalSnapshot = store.snapshot();
  const resolutionMeasured = timed(() => scheduler.advance(checkpoint, finalSnapshot));
  checkpoint = resolutionMeasured.value.checkpoint;
  return {
    tailReplayUsPerFact: (bulkMeasured.elapsedMs * 1_000) / bulkTail.length,
    directAppendUs,
    resolutionMs: resolutionMeasured.elapsedMs,
    directAppendEvaluations,
    finalSnapshot,
    checkpoint,
  };
}

function retainedHeapMiB(run: () => unknown): number {
  const samples = 10;
  globalThis.gc?.();
  const before = process.memoryUsage().heapUsed;
  globalThis.proposalSchedulerRetained = Array.from({ length: samples }, run);
  globalThis.gc?.();
  const after = process.memoryUsage().heapUsed;
  globalThis.proposalSchedulerRetained = undefined;
  return Math.max(0, after - before) / samples / 1024 / 1024;
}

function isolatedHeapMiB(candidate: string, nodeCount: number): number {
  const output = execFileSync(
    process.execPath,
    ["--expose-gc", "node_modules/tsx/dist/cli.mjs", process.argv[1]!],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PROPOSAL_SCHEDULER_HEAP_ONLY: candidate,
        PROPOSAL_SCHEDULER_NODES: String(nodeCount),
      },
    },
  );
  return Number(output.trim());
}

function measureCandidate(
  scheduler: ReconcileScheduler,
  nodeCount: number,
  baseFacts: readonly Fact[],
  baseSnapshot: FactSnapshot,
): Measurement {
  const heap = isolatedHeapMiB(scheduler.name, nodeCount);
  const startupMs = measureStartup(scheduler, baseSnapshot);
  const tail = measureTail(scheduler, baseFacts, baseSnapshot);
  const fullRebuild = timed(() => scheduler.rebuild(tail.finalSnapshot, "origin"));
  const checkpointMiB = Buffer.byteLength(encodeSchedulerCheckpoint(tail.checkpoint)) / 1024 / 1024;
  return {
    candidate: scheduler.name,
    nodes: nodeCount,
    facts: tail.finalSnapshot.facts.length,
    startupMs,
    fullRebuildMs: fullRebuild.elapsedMs,
    tailReplayUsPerFact: tail.tailReplayUsPerFact,
    directAppendUs: tail.directAppendUs,
    resolutionMs: tail.resolutionMs,
    checkpointMiB,
    retainedHeapMiB: heap,
    directAppendEvaluations: tail.directAppendEvaluations,
  };
}

function fixed(value: number, digits = 2): string {
  return value.toFixed(digits);
}

function main(): void {
  const nodeCount = Number(process.env.PROPOSAL_SCHEDULER_NODES ?? 2_000);
  const baseFacts = workspaceFacts(nodeCount);
  const baseSnapshot = snapshotOf(baseFacts);
  const heapOnly = process.env.PROPOSAL_SCHEDULER_HEAP_ONLY;
  if (heapOnly) {
    const scheduler = schedulerCandidates().find((candidate) => candidate.name === heapOnly);
    if (!scheduler) throw new Error(`unknown scheduler candidate ${heapOnly}`);
    console.log(retainedHeapMiB(() => scheduler.rebuild(baseSnapshot, "review")).toFixed(4));
    return;
  }

  const measurements = schedulerCandidates().map((scheduler) =>
    measureCandidate(scheduler, nodeCount, baseFacts, baseSnapshot),
  );
  console.log(
    "| Candidate | Nodes | Facts | Startup ms | Full rebuild ms | Tail replay µs/fact | Direct append µs | Resolution ms | Checkpoint MiB | Heap MiB | Direct evals |",
  );
  console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const measurement of measurements) {
    console.log(
      `| ${measurement.candidate} | ${measurement.nodes} | ${measurement.facts} | ${fixed(measurement.startupMs)} | ${fixed(measurement.fullRebuildMs)} | ${fixed(measurement.tailReplayUsPerFact)} | ${fixed(measurement.directAppendUs)} | ${fixed(measurement.resolutionMs)} | ${fixed(measurement.checkpointMiB)} | ${fixed(measurement.retainedHeapMiB)} | ${measurement.directAppendEvaluations} |`,
    );
  }
}

main();
