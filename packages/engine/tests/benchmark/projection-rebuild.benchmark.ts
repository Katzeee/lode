import { performance } from "node:perf_hooks";

import { frontierEquals } from "../../src/domain/fact/index.js";
import { CURRENT_PROJECTION_VERSIONS } from "../../src/domain/reconcile/index.js";
import { WorkspaceProjection } from "../../src/subsystems/workspace/projection/index.js";
import { Facts } from "../support/reconcile/reconcile-test-helpers.js";

const DEFAULT_SCALES = [1_000, 5_000, 15_000];
const ITERATIONS = 5;

type Measurement = Readonly<{
  nodes: number;
  facts: number;
  medianMs: number;
  p95Ms: number;
  maximumMs: number;
}>;

const scales = process.argv
  .slice(2)
  .map(Number)
  .filter((value) => Number.isSafeInteger(value) && value > 0);
const measurements = (scales.length > 0 ? scales : DEFAULT_SCALES).map(measureProjectionOpen);

console.table(measurements);

function measureProjectionOpen(nodes: number): Measurement {
  const snapshot = fixture(nodes);
  const elapsed: number[] = [];
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    globalThis.gc?.();
    const started = performance.now();
    const projection = WorkspaceProjection.open("workspace", snapshot, CURRENT_PROJECTION_VERSIONS);
    elapsed.push(performance.now() - started);
    if (!frontierEquals(projection.identity.frontier, snapshot.frontier)) {
      throw new Error("Projection benchmark did not publish the measured Fact frontier");
    }
  }
  elapsed.sort((left, right) => left - right);
  return {
    nodes,
    facts: snapshot.facts.length,
    medianMs: round(percentile(elapsed, 0.5)),
    p95Ms: round(percentile(elapsed, 0.95)),
    maximumMs: round(elapsed.at(-1) ?? 0),
  };
}

function fixture(nodes: number): ReturnType<Facts["snapshot"]> {
  const facts = new Facts();
  for (let index = 0; index < nodes; index += 1) {
    const parentIndex = Math.floor((index - 1) / 10);
    facts.addPlaced(
      `node-${index.toString().padStart(8, "0")}`,
      index === 0 ? "workspace" : `node-${parentIndex.toString().padStart(8, "0")}`,
    );
  }
  return facts.snapshot();
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
