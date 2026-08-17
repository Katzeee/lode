import { PREPARED_MUTATION_EVIDENCE_KEYS } from "./types.js";

export function inputObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Edit mutation must be an object");
  }
  return value as Record<string, unknown>;
}

export function exactInputKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) {
    throw new Error(`Unknown input field: ${unknown}`);
  }
}

export function nonemptyInputString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

export function rejectPreparedEvidence(edit: Record<string, unknown>): void {
  const evidence = PREPARED_MUTATION_EVIDENCE_KEYS.find((key) => key in edit);
  if (evidence) {
    throw new Error(`Prepared Fact evidence is not accepted by the edit interface: ${evidence}`);
  }
}
