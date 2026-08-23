import type { AuthoredAction } from "../../../../domain/fact/index.js";
import type { AuthoredActionBatch } from "../action-batch.js";

export function requireAuthoredActionBatch(actions: readonly AuthoredAction[]): AuthoredActionBatch {
  const [first, ...rest] = actions;
  if (!first) {
    throw new Error("Action expansion requires at least one action");
  }
  return [first, ...rest];
}
