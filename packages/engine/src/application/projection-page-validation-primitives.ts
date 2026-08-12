import type { JsonValue } from "../domain/fact/index.js";

export function parseIndexed<T>(
  value: unknown,
  label: string,
  parse: (value: unknown) => T,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(object(value, label)).map(([key, item]) => [key, parse(item)]),
  );
}

export function empty(value: unknown, label: string): Record<string, never> {
  const result = object(value, label);
  if (Object.keys(result).length > 0) {
    throw new Error(`${label} must be empty outside its page section`);
  }
  return {};
}

export function emptyArray(value: unknown, label: string): readonly never[] {
  if (!Array.isArray(value) || value.length > 0) {
    throw new Error(`${label} must be empty outside its page section`);
  }
  return [];
}

export function jsonRecord(value: unknown): Record<string, JsonValue> {
  const result = object(value, "JSON object");
  for (const child of Object.values(result)) {
    json(child);
  }
  return result as Record<string, JsonValue>;
}

export function stringArray(value: unknown): string[] {
  return array(value, "string array", (item) => nonempty(item, "identity"));
}

export function array<T>(value: unknown, label: string, parse: (value: unknown) => T): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map(parse);
}

export function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function exact(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new Error(`${label} has unknown or missing fields`);
  }
}

export function nonempty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

export function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

export function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : nonempty(value, label);
}

export function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function json(value: unknown): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(json);
    return;
  }
  if (typeof value === "object" && value !== null) {
    Object.values(value).forEach(json);
    return;
  }
  throw new Error("Value is not JSON");
}
