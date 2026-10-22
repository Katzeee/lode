import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rmdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  homeNamePattern,
  normalizeHomePath,
  probeDaemon,
  readHomeRegistry,
  registeredHomeAtPath,
  writeHomeRegistry,
  type HomeRegistryFile,
} from "@lode/desktop-client";

import { CliError, okOutcome, type CommandResult } from "../outcome/index.js";
import type { CommandDefinition, ManagementCommandContext } from "../command/index.js";

/**
 * The `home` command family: registration-level management of Lode Homes.
 * These commands never touch a daemon — they edit the registry and initialize
 * home directories, and dispatch through the composition root.
 */

type HomeManagementPort = Readonly<{
  registry(): Promise<HomeRegistryFile>;
  writeRegistry(update: (document: Record<string, unknown>) => void): Promise<void>;
  /** Best-effort liveness probe that never starts anything. */
  probe(path: string): Promise<boolean>;
}>;

export function homeCommands(): readonly CommandDefinition[] {
  return [
    {
      path: ["home", "list"],
      summary: "List registered Lode Homes and their best-effort run state.",
      positionals: [],
      options: [],
      kind: "read",
      paginated: false,
      needsWorkspace: false,
      runManagement: (context) => listHomes(homePort(context)),
    },
    {
      path: ["home", "add"],
      summary: "Register a Home; initialize it when the target is an empty directory.",
      positionals: [
        ["name", "Home name (^[a-z][a-z0-9-]*$)"],
        ["path", "Home directory"],
      ],
      options: [],
      kind: "write",
      paginated: false,
      needsWorkspace: false,
      runManagement: (context, args) => addHome(args.positional("name"), args.positional("path"), homePort(context)),
    },
    {
      path: ["home", "use"],
      summary: "Set the default Home.",
      positionals: [["name", "Registered home name"]],
      options: [],
      kind: "write",
      paginated: false,
      needsWorkspace: false,
      runManagement: (context, args) => useHome(args.positional("name"), homePort(context)),
    },
    {
      path: ["home", "remove"],
      summary: "Remove a Home registration (never stops a daemon or deletes data).",
      positionals: [["name", "Registered home name"]],
      options: [],
      kind: "write",
      paginated: false,
      needsWorkspace: false,
      runManagement: (context, args) => removeHome(args.positional("name"), homePort(context)),
    },
  ];
}

function homePort(context: ManagementCommandContext): HomeManagementPort {
  return {
    registry: () => readHomeRegistry(context.configDir),
    writeRegistry: (update) => writeHomeRegistry(context.configDir, update),
    probe: async (path) => {
      const probe = await probeDaemon({ name: "", path });
      probe?.client.close();
      return probe !== null;
    },
  };
}

async function listHomes(port: HomeManagementPort): Promise<CommandResult> {
  const registry = await port.registry();
  const entries = await Promise.all(
    Object.entries(registry.homes).map(async ([name, entry]) => ({
      name,
      path: entry.path,
      running: await port.probe(entry.path),
    })),
  );
  const defaultHome = registry.defaultHome;
  return okOutcome(
    {
      homes: entries.map((entry) => ({
        name: entry.name,
        path: entry.path,
        default: entry.name === defaultHome,
        running: entry.running,
      })),
    },
    {
      view: {
        kind: "table",
        columns: ["default", "name", "path", "daemon"],
        rows: entries.map((entry) => [
          entry.name === defaultHome ? "*" : "",
          entry.name,
          entry.path,
          entry.running ? "running" : "-",
        ]),
      },
    },
  );
}

async function addHome(name: string, path: string, port: HomeManagementPort): Promise<CommandResult> {
  if (!homeNamePattern.test(name)) {
    throw new CliError("invalid-value", `Home name must match ${homeNamePattern.source}`);
  }
  const registry = await port.registry();
  if (registry.homes[name] !== undefined) {
    throw new CliError("conflict", `Home "${name}" is already registered at ${registry.homes[name]?.path}`);
  }
  const normalized = await initializeHome(normalizeHomePath(path), registry);
  const first = registry.defaultHome === undefined;
  await port.writeRegistry((document) => {
    const homes = (document["homes"] as Record<string, { path: string }>) ?? {};
    homes[name] = { path: normalized };
    document["homes"] = homes;
    if (first) {
      document["default_home"] = name;
    }
  });
  return okOutcome(
    { home: { name, path: normalized, default: first } },
    {
      view: {
        kind: "text",
        lines: [`Registered home "${name}" at ${normalized}.`, ...(first ? [`Default home set to "${name}".`] : [])],
      },
    },
  );
}

/** Empty directory → initialize; valid home → register as-is; anything else → refuse. */
async function initializeHome(normalized: string, registry: HomeRegistryFile): Promise<string> {
  const existing = await statOrNull(normalized);
  if (existing === null) {
    throw new CliError("invalid-value", `Path does not exist: ${normalized}`);
  }
  if (!existing.isDirectory()) {
    throw new CliError("invalid-value", `Path is not a directory: ${normalized}`);
  }
  const registered = registeredHomeAtPath(registry, normalized);
  if (registered !== undefined) {
    throw new CliError("conflict", `Path ${normalized} is already registered as home "${registered}"`);
  }
  const token = await fileHasText(join(normalized, "token"));
  const data = (await statOrNull(join(normalized, "data")))?.isDirectory() === true;
  if (token && data) {
    return normalized;
  }
  if ((await readdir(normalized)).length > 0) {
    throw new CliError(
      "invalid-value",
      `Directory is not empty and not a Lode Home (needs token + data/): ${normalized}`,
    );
  }
  const dataPath = join(normalized, "data");
  await mkdir(dataPath);
  try {
    await writeFile(join(normalized, "token"), `${randomBytes(32).toString("hex")}\n`, { mode: 0o600, flag: "wx" });
  } catch (error) {
    try {
      await rmdir(dataPath);
    } catch (cleanupError) {
      const failure = new AggregateError(
        [toError(error), toError(cleanupError)],
        "Home initialization failed to roll back",
        {
          cause: error,
        },
      );
      throw failure;
    }
    throw error;
  }
  return normalized;
}

async function statOrNull(path: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
  try {
    return await stat(path);
  } catch (error) {
    if (hasCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

async function fileHasText(path: string): Promise<boolean> {
  try {
    return (await readFile(path, "utf8")).trim().length > 0;
  } catch (error) {
    if (hasCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

function hasCode(value: unknown, code: string): boolean {
  return typeof value === "object" && value !== null && "code" in value && value.code === code;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

async function useHome(name: string, port: HomeManagementPort): Promise<CommandResult> {
  const registry = await port.registry();
  if (registry.homes[name] === undefined) {
    throw unknownHome(name, registry);
  }
  await port.writeRegistry((document) => {
    document["default_home"] = name;
  });
  return okOutcome(
    { defaultHome: name },
    { view: { kind: "text", lines: [`Default home is now "${name}" (${registry.homes[name]?.path}).`] } },
  );
}

async function removeHome(name: string, port: HomeManagementPort): Promise<CommandResult> {
  const registry = await port.registry();
  if (registry.homes[name] === undefined) {
    throw unknownHome(name, registry);
  }
  const path = registry.homes[name]?.path;
  await port.writeRegistry((document) => {
    const homes = (document["homes"] as Record<string, { path: string }>) ?? {};
    delete homes[name];
    document["homes"] = homes;
    if (document["default_home"] === name) {
      delete document["default_home"];
    }
  });
  return okOutcome(
    { removed: { name, path } },
    {
      view: {
        kind: "text",
        lines: [`Removed home registration "${name}".`, "Daemon and data on disk are untouched."],
      },
    },
  );
}

function unknownHome(name: string, registry: HomeRegistryFile): CliError {
  const registered = Object.keys(registry.homes);
  const known = registered.length === 0 ? " No homes are registered." : ` Registered: ${registered.join(", ")}.`;
  return new CliError("target-not-found", `Home "${name}" is not registered.${known}`);
}
