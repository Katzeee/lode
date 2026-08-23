import type { Fact } from "../../src/domain/fact/index.js";

export function uniqueFacts(values: readonly (Fact | undefined)[]): readonly Fact[] {
  return [...new Map(values.flatMap((fact) => (fact ? [[fact.id, fact] as const] : []))).values()];
}
