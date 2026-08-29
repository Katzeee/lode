import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { parse, stringify } from "smol-toml";

/** The user's Lode configuration directory: Home registry + CLI preferences.
 * Hand-authored, dotfiles-friendly; machine-local runtime material never
 * lives here — it belongs to each Home directory. */
export function lodeConfigDir(): string {
  return join(homedir(), ".lode");
}

export const homeNamePattern = /^[a-z][a-z0-9-]*$/u;

export type HomeEntry = Readonly<{ path: string }>;

export type HomeRegistryFile = Readonly<{
  defaultHome?: string;
  homes: Readonly<Record<string, HomeEntry>>;
}>;

/** Everything in lode.toml as raw data — unknown keys ride along untouched. */
export type HomeRegistryDocument = Record<string, unknown> & {
  default_home?: string;
  homes?: Record<string, { path?: unknown }>;
};

export function registryFile(configDir: string): string {
  return join(configDir, "lode.toml");
}

export async function readHomeRegistry(configDir: string): Promise<HomeRegistryFile> {
  let text: string;
  try {
    text = await readFile(registryFile(configDir), "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      return { homes: {} };
    }
    throw new Error(`Cannot read lode.toml: ${describe(error)}`, { cause: error });
  }
  let document: unknown;
  try {
    document = parse(text);
  } catch (error) {
    throw new Error(`lode.toml is not valid TOML: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  return toRegistry(document);
}

export async function writeHomeRegistry(
  configDir: string,
  update: (document: HomeRegistryDocument) => void,
): Promise<void> {
  let text: string;
  try {
    text = await readFile(registryFile(configDir), "utf8");
  } catch (error) {
    if (!isMissingFile(error)) {
      throw new Error(`Cannot read lode.toml: ${describe(error)}`, { cause: error });
    }
    text = "";
  }
  const document = (text.length === 0 ? {} : parse(text)) as HomeRegistryDocument;
  update(document);
  const target = registryFile(configDir);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  try {
    await writeFile(temporary, stringify(document), "utf8");
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/** Normalizes a user-provided home path for registration and uniqueness. */
export function normalizeHomePath(path: string): string {
  return resolve(path);
}

export function assertHomePathAvailable(registry: HomeRegistryFile, normalizedPath: string): void {
  for (const [name, entry] of Object.entries(registry.homes)) {
    if (normalizeHomePath(entry.path) === normalizedPath) {
      throw new Error(`Path ${normalizedPath} is already registered as home "${name}"`);
    }
  }
}

function toRegistry(document: unknown): HomeRegistryFile {
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    throw new Error("lode.toml must be a TOML table at the top level");
  }
  const record = document as Record<string, unknown>;
  const defaultHome = record["default_home"];
  if (defaultHome !== undefined && typeof defaultHome !== "string") {
    throw new Error("lode.toml: default_home must be a string");
  }
  const homes: Record<string, HomeEntry> = {};
  const homesValue = record["homes"];
  if (homesValue !== undefined) {
    if (typeof homesValue !== "object" || homesValue === null || Array.isArray(homesValue)) {
      throw new Error("lode.toml: [homes] must be a table");
    }
    for (const [name, entry] of Object.entries(homesValue as Record<string, unknown>)) {
      if (!homeNamePattern.test(name)) {
        throw new Error(`lode.toml: home name "${name}" must match ${homeNamePattern.source}`);
      }
      const path = (entry as { path?: unknown })?.path;
      if (typeof path !== "string" || path.length === 0) {
        throw new Error(`lode.toml: [homes.${name}] requires a path string`);
      }
      homes[name] = { path };
    }
  }
  return { defaultHome, homes };
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
