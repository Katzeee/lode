import type { GraphAction } from "../fact/index.js";

export type CompensationStep =
  Readonly<{ kind: "ready"; actions: readonly GraphAction[] }> | Readonly<{ kind: "stale"; reason: string }>;

export function noCompensation(): CompensationStep {
  return { kind: "ready", actions: [] };
}
