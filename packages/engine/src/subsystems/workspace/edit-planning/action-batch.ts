import type { GraphAction } from "../../../domain/fact/index.js";

export type AuthoredActionBatch = readonly [GraphAction, ...GraphAction[]];

export function authoredActionBatch(actions: AuthoredActionBatch): AuthoredActionBatch {
  return actions;
}

export function singleAuthoredActionBatch(action: GraphAction): AuthoredActionBatch {
  return [action];
}

export function requireAuthoredActionBatch(actions: readonly GraphAction[]): AuthoredActionBatch {
  const [first, ...rest] = actions;
  if (!first) {
    throw new Error("Authored Action batch requires at least one action");
  }
  return [first, ...rest];
}
