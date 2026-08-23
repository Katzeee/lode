import type { AuthoredAction } from "../fact/index.js";

export type CompensationStep =
  Readonly<{ kind: "ready"; actions: readonly AuthoredAction[] }> | Readonly<{ kind: "stale"; reason: string }>;

export function noCompensation(): CompensationStep {
  return { kind: "ready", actions: [] };
}
