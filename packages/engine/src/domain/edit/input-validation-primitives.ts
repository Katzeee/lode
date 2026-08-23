import { parseNodeSeed, type NodeSeed } from "../fact/index.js";

export function inputObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Edit action must be an object");
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

export function optionalNodeSeed(value: unknown): NodeSeed | undefined {
  return value === undefined ? undefined : parseNodeSeed(value);
}
