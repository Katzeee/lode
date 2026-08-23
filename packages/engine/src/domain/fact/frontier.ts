import type { CausalCoordinate, Fact, FactFrontier } from "./types.js";
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

export function factObserves(observer: CausallyOrdered, observed: CausallyOrdered): boolean {
  if (
    observer.coordinate.dot.replicaId === observed.coordinate.dot.replicaId &&
    observer.coordinate.dot.sequence === observed.coordinate.dot.sequence
  ) {
    return observer.index !== undefined && observed.index !== undefined && observer.index > observed.index;
  }
  const { replicaId, sequence } = observed.coordinate.dot;
  return (observer.coordinate.observed[replicaId] ?? 0) >= sequence;
}

export function causalMaxima<Value extends CausallyOrdered>(
  values: readonly Value[],
  sameSemanticValue: (left: Value, right: Value) => boolean,
): readonly Value[] {
  return values.filter(
    (candidate) =>
      !values.some(
        (observer) =>
          observer !== candidate && sameSemanticValue(observer, candidate) && factObserves(observer, candidate),
      ),
  );
}

export function frontierOf(facts: readonly Fact[]): FactFrontier {
  const frontier: Record<string, number> = {};
  for (const fact of facts) {
    const { replicaId, sequence } = fact.coordinate.dot;
    frontier[replicaId] = Math.max(frontier[replicaId] ?? 0, sequence);
  }
  return normalizeFrontier(frontier);
}

type CausallyOrdered = Readonly<{ coordinate: CausalCoordinate; index?: number }>;

export function compareCausalOrder(left: CausallyOrdered, right: CausallyOrdered): number {
  return (
    left.coordinate.lamport - right.coordinate.lamport ||
    stableStringCompare(left.coordinate.dot.replicaId, right.coordinate.dot.replicaId) ||
    left.coordinate.dot.sequence - right.coordinate.dot.sequence ||
    (left.index ?? 0) - (right.index ?? 0)
  );
}
