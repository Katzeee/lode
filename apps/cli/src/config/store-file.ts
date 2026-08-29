import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { CliError } from "../outcome/index.js";

export async function readConfigurationStore<Value>(
  path: string,
  label: string,
  parse: (value: unknown) => Value,
): Promise<Value | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }
    throw configurationError(`Cannot read ${label}`, error);
  }
  try {
    return parse(JSON.parse(text) as unknown);
  } catch (error) {
    throw configurationError(`${label} is malformed`, error);
  }
}

export async function writeConfigurationStore(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export function stringMapStore(value: unknown, field: string, label: string): Readonly<Record<string, string>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== field)) {
    throw new Error(`${label} contains an unknown field`);
  }
  const entries = record[field];
  if (typeof entries !== "object" || entries === null || Array.isArray(entries)) {
    throw new Error(`${label}.${field} must be an object`);
  }
  const pairs = Object.entries(entries as Record<string, unknown>);
  if (pairs.some(([key, entry]) => key.length === 0 || typeof entry !== "string" || entry.length === 0)) {
    throw new Error(`${label}.${field} must map non-empty identities to non-empty strings`);
  }
  return Object.fromEntries(pairs) as Readonly<Record<string, string>>;
}

function configurationError(message: string, cause: unknown): CliError {
  return new CliError("configuration-missing", `${message}: ${cause instanceof Error ? cause.message : String(cause)}`);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT";
}
