import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { parse } from "smol-toml";

import { CliError } from "../outcome/index.js";

/**
 * CLI preferences from `[cli]` in lode.toml (flag > env > file) and the
 * per-home sync endpoint table at `<home>/sync-endpoints.json`. Connection
 * material (token/endpoint) is NOT configuration — it is read from the home
 * directory by the desktop-client, never stored here.
 */

export type CliPreferences = Readonly<{
  defaultFormat?: "human" | "json";
  defaultLimit?: number;
}>;

export async function readCliPreferences(configFile: string): Promise<CliPreferences> {
  let text: string;
  try {
    text = await readFile(configFile, "utf8");
  } catch {
    return {};
  }
  let cliTable: unknown;
  try {
    const document = parse(text) as Record<string, unknown>;
    cliTable = document["cli"];
  } catch (error) {
    throw new CliError("configuration-missing", `lode.toml is not valid TOML: ${describe(error)}`);
  }
  if (cliTable === undefined) {
    return {};
  }
  if (typeof cliTable !== "object" || cliTable === null || Array.isArray(cliTable)) {
    throw new CliError("configuration-missing", "lode.toml: [cli] must be a table");
  }
  const record = cliTable as Record<string, unknown>;
  const format = record["default_format"];
  if (format !== undefined && format !== "human" && format !== "json") {
    throw new CliError("configuration-missing", "lode.toml: cli.default_format must be human or json");
  }
  const limit = record["default_limit"];
  if (limit !== undefined && (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 99)) {
    throw new CliError("configuration-missing", "lode.toml: cli.default_limit must be an integer between 1 and 99");
  }
  return {
    ...(format === undefined ? {} : { defaultFormat: format }),
    ...(limit === undefined ? {} : { defaultLimit: limit as number }),
  };
}

export function syncEndpointsFile(homePath: string): string {
  return join(homePath, "sync-endpoints.json");
}

type SyncEndpointStore = Readonly<{ syncEndpoints?: Readonly<Record<string, string>> }>;

export async function readSyncEndpoint(homePath: string, workspaceId: string): Promise<string | null> {
  const store = await readStore(homePath);
  return store.syncEndpoints?.[workspaceId] ?? null;
}

export async function setSyncEndpoint(homePath: string, workspaceId: string, endpoint: string): Promise<void> {
  const store = await readStore(homePath);
  const updated: SyncEndpointStore = {
    ...store,
    syncEndpoints: { ...(store.syncEndpoints ?? {}), [workspaceId]: endpoint },
  };
  // ponytail: atomic rename prevents torn files; concurrent writers last-write-win.
  const target = syncEndpointsFile(homePath);
  const temporary = `${target}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

async function readStore(homePath: string): Promise<SyncEndpointStore> {
  try {
    return JSON.parse(await readFile(syncEndpointsFile(homePath), "utf8")) as SyncEndpointStore;
  } catch {
    return {};
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
