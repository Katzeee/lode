import type { AuthoredAction } from "../../../domain/fact/index.js";

export type AuthoredActionBatch = readonly [AuthoredAction, ...AuthoredAction[]];

export function authoredActionBatch(actions: AuthoredActionBatch): AuthoredActionBatch {
  return actions;
}

export function singleAuthoredActionBatch(action: AuthoredAction): AuthoredActionBatch {
  return [action];
}
