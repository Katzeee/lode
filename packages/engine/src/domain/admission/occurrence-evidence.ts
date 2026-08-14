import { canonicalJson, type Mutation } from "../fact/index.js";
import {
  completeMutableOccurrenceEvidence,
  completeOccurrenceCreate,
} from "../mutation-evidence/index.js";
import type { Projection } from "../reconcile/index.js";

export function validateOccurrenceCreate(
  mutation: Extract<Mutation, { kind: "occurrence-create" }>,
  available: Projection,
): void {
  completeOccurrenceCreate(mutation, available);
}

export function validateOccurrenceEvidence(
  mutation: Extract<Mutation, { kind: "occurrence-move" | "occurrence-delete" }>,
  previous: Projection,
  available: Projection,
): void {
  const expected = completeMutableOccurrenceEvidence(mutation, previous, available);
  if (!expected) {
    throw new Error("Occurrence evidence requires a mutable Occurrence Mutation");
  }
  assertSame(
    expected.previousParentNodeId,
    mutation.previousParentNodeId,
    "Occurrence previous parent evidence",
  );
  assertSame(
    expected.previousAnchor,
    mutation.previousAnchor,
    "Occurrence previous anchor evidence",
  );
}

function assertSame(expected: unknown, actual: unknown, label: string): void {
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    throw new Error(`${label} does not match the observed projection`);
  }
}
