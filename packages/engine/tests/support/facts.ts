import { buildFactSnapshot, type Fact, type FactSnapshot } from "../../src/domain/fact/index.js";

export function uniqueFacts(values: readonly (Fact | undefined)[]): readonly Fact[] {
  return [...new Map(values.flatMap((fact) => (fact ? [[fact.id, fact] as const] : []))).values()];
}

export function snapshotOf(facts: readonly Fact[]): FactSnapshot {
  return buildFactSnapshot("workspace", uniqueFacts(facts));
}
