import type { JsonValue } from "./types.js";

export function assertJsonValue(value: unknown, label: string): asserts value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      assertJsonValue(child, label);
    }
    return;
  }
  if (isObject(value)) {
    for (const child of Object.values(value)) {
      assertJsonValue(child, label);
    }
    return;
  }
  throw new Error(`${label} is not JSON data`);
}

export function assertStringArray(value: unknown, label: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  for (const item of value) {
    requireString(item, label);
  }
}

export function assertNullableString(value: unknown, label: string): void {
  if (value !== null) {
    requireString(value, label);
  }
}

export function assertOneOf(value: unknown, allowed: readonly string[], label: string): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`Invalid ${label}`);
  }
}

export function requireString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is invalid`);
  }
}

export function requireStringAllowEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`${label} is invalid`);
  }
}

export function requireNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number") {
    throw new Error(`${label} is invalid`);
  }
}

export function requireSafeInteger(
  value: unknown,
  minimum: number,
  label: string,
): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${label} is invalid`);
  }
}

export function assertObject(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (!isObject(value)) {
    throw new Error(`${label} must be an object`);
  }
}

export function assertKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra) {
    throw new Error(`${label} contains unknown field: ${extra}`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
