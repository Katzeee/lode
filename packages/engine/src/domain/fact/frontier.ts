import type { Fact, FactFrontier } from "./types.js";
import { stableStringCompare } from "./canonical.js";

export function normalizeFrontier(frontier: FactFrontier): FactFrontier {
  return Object.fromEntries(
    Object.entries(frontier)
      .filter(([, sequence]) => sequence > 0)
      .sort(([left], [right]) => stableStringCompare(left, right)),
  );
}

export function frontierEquals(left: FactFrontier, right: FactFrontier): boolean {
  return JSON.stringify(normalizeFrontier(left)) === JSON.stringify(normalizeFrontier(right));
}

export function frontierCovers(have: FactFrontier, required: FactFrontier): boolean {
  return Object.entries(required).every(([replicaId, sequence]) => (have[replicaId] ?? 0) >= sequence);
}

export function frontierIncludesFact(frontier: FactFrontier, fact: Fact): boolean {
  const { replicaId, sequence } = fact.coordinate.dot;
  return (frontier[replicaId] ?? 0) >= sequence;
}

export function factObserves(observer: Fact, observed: Fact): boolean {
  return frontierIncludesFact(observer.coordinate.observed, observed);
}

export function frontierOf(facts: readonly Fact[]): FactFrontier {
  const frontier: Record<string, number> = {};
  for (const fact of facts) {
    const { replicaId, sequence } = fact.coordinate.dot;
    frontier[replicaId] = Math.max(frontier[replicaId] ?? 0, sequence);
  }
  return normalizeFrontier(frontier);
}

export function compareFacts(left: Fact, right: Fact): number {
  return (
    left.coordinate.lamport - right.coordinate.lamport ||
    stableStringCompare(left.coordinate.dot.replicaId, right.coordinate.dot.replicaId) ||
    left.coordinate.dot.sequence - right.coordinate.dot.sequence
  );
}
