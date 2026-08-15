import type { Mutation } from "../fact/index.js";
import type { JsonValue } from "../fact/index.js";

export type CompensationStep =
  Readonly<{ kind: "ready"; mutations: readonly Mutation[] }> | Readonly<{ kind: "stale"; reason: string }>;

export function noCompensation(): CompensationStep {
  return { kind: "ready", mutations: [] };
}

export function valueState(
  values: Readonly<Record<string, JsonValue>> | undefined,
  key: string,
): Readonly<{ present: boolean; value?: JsonValue }> {
  return values && Object.hasOwn(values, key) ? { present: true, value: values[key] } : { present: false };
}
