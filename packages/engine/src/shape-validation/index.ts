export function parseIndexed<T>(
  value: unknown,
  label: string,
  parse: (value: unknown, identity: string) => T,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(object(value, label)).map(([identity, item]) => [identity, parse(item, identity)]),
  );
}

export function stringArray(value: unknown, label = "string array"): string[] {
  return array(value, label, (item) => nonempty(item, label));
}

export function array<T>(value: unknown, label: string, parse: (value: unknown) => T): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map(parse);
}

export function object(value: unknown, label: string): Record<string, unknown> {
  assertObject(value, label);
  return value;
}

export function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error(`${label} has unknown or missing fields`);
  }
}

export function nonempty(value: unknown, label: string): string {
  requireString(value, label);
  return value;
}

export function stringValue(value: unknown, label: string): string {
  requireStringAllowEmpty(value, label);
  return value;
}

export function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : nonempty(value, label);
}

export function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

export function safeInteger(value: unknown, minimum: number, label: string): number {
  requireSafeInteger(value, minimum, label);
  return value;
}

export function enumValue<const T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

export function assertJsonValue(value: unknown, label: string): void {
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
  if (isRecord(value)) {
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

export function assertFrontier(value: unknown, label: string): void {
  assertObject(value, label);
  for (const [replicaId, sequence] of Object.entries(value)) {
    requireString(replicaId, `${label} Replica identity`);
    requireSafeInteger(sequence, 0, `${label} sequence`);
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

export function requireSafeInteger(value: unknown, minimum: number, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${label} is invalid`);
  }
}

export function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

export function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function assertKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra) {
    throw new Error(`${label} contains unknown field: ${extra}`);
  }
}
