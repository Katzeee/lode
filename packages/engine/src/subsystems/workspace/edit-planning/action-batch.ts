import type { GraphAction } from "../../../domain/fact/index.js";

export type AuthoredActionBatch = readonly [GraphAction, ...GraphAction[]];

export function authoredActionBatch(actions: AuthoredActionBatch): AuthoredActionBatch {
  return actions;
}

export function singleAuthoredActionBatch(action: GraphAction): AuthoredActionBatch {
  return [action];
}
