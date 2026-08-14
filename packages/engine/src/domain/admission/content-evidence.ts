import { canonicalJson, type Mutation, type ValueMutation } from "../fact/index.js";
import {
  completeTextMarkEvidence,
  completeTextSpliceEvidence,
  completeValueMutationEvidence,
} from "../mutation-evidence/index.js";
import type { Projection } from "../reconcile/index.js";

export function validateTextSpliceEvidence(
  mutation: Extract<Mutation, { kind: "text-splice" }>,
  available: Projection,
): void {
  const expected = completeTextSpliceEvidence(mutation, available);
  assertSame(expected.deletedAtoms, mutation.deletedAtoms, "Text deletion evidence");
}

export function validateTextMarkEvidence(
  mutation: Extract<Mutation, { kind: "text-mark" }>,
  previous: Projection,
  available: Projection,
): void {
  const expected = completeTextMarkEvidence(mutation, previous, available);
  assertSame(expected.previous, mutation.previous, "Text mark previous evidence");
}

export function validateValueMutationEvidence(
  mutation: ValueMutation,
  previous: Projection,
  available: Projection,
): void {
  const expected = completeValueMutationEvidence(mutation, previous, available);
  assertSame(expected.previous, mutation.previous, "Value previous evidence");
}

function assertSame(expected: unknown, actual: unknown, label: string): void {
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    throw new Error(`${label} does not match the observed projection`);
  }
}
