import type { SequenceAnchor } from "./types.js";

export function validateAnchor(anchor: SequenceAnchor, factIdentity: string): void {
  if (anchor.after !== null && anchor.before !== null && anchor.after === anchor.before) {
    throw new Error(`Sequence anchor repeats one identity: ${factIdentity}`);
  }
  requireNullableIdentity(anchor.after, "anchor endpoint", factIdentity);
  requireNullableIdentity(anchor.before, "anchor endpoint", factIdentity);
}

export function requireIdentity(value: string, label: string, factIdentity: string): void {
  if (value.length === 0) {
    throw new Error(`${label} identity is empty: ${factIdentity}`);
  }
}

function requireNullableIdentity(value: string | null, label: string, factIdentity: string): void {
  if (value !== null) {
    requireIdentity(value, label, factIdentity);
  }
}
