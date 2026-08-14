import { canonicalJson, type Mutation } from "../fact/index.js";
import { assertNodeTypeCompatible, completeNodeOwnerEvidence } from "../mutation-evidence/index.js";
import type { Projection } from "../reconcile/index.js";

export function validateNodeOwnerEvidence(
  mutation: Extract<Mutation, { kind: "node-owner-set" }>,
  previous: Projection,
  available: Projection,
): void {
  const expected = completeNodeOwnerEvidence(mutation, previous, available);
  if (canonicalJson(expected.previousOwnerNodeId) !== canonicalJson(mutation.previousOwnerNodeId)) {
    throw new Error("Owner previous evidence does not match the observed projection");
  }
}

export function validateNodeTypeEvidence(
  mutation: Extract<Mutation, { kind: "node-type-declare" }>,
  available: Projection,
): void {
  assertNodeTypeCompatible(mutation, available);
}
