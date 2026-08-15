import { canonicalJson } from "../fact/index.js";

export function assertEvidenceEqual(expected: unknown, actual: unknown, label: string): void {
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    throw new Error(`${label} does not match the observed projection`);
  }
}
