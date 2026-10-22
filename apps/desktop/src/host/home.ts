import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Stats } from "node:fs";

import {
  homeNamePattern,
  lodeConfigDir,
  readHomeRegistry,
  selectHome,
  writeHomeRegistry,
  type HomeSelection,
} from "@lode/desktop-client";

type DesktopHomeInputs = Readonly<{
  argv: readonly string[];
  environment: Readonly<Record<string, string | undefined>>;
}>;

export async function resolveDesktopHome(inputs: DesktopHomeInputs): Promise<HomeSelection> {
  const directPath = argument(inputs.argv, "--lode-home-path");
  const requestedName = argument(inputs.argv, "--lode-home-name");
  if (requestedName !== undefined && !homeNamePattern.test(requestedName)) {
    throw new Error(`Home name must match ${homeNamePattern.source}`);
  }
  if (directPath !== undefined) {
    const selection = { name: requestedName ?? "main", path: resolve(directPath) };
    await prepareHome(selection.path);
    return selection;
  }

  const configDir = inputs.environment.LODE_CONFIG_DIR ?? lodeConfigDir();
  const registry = await readHomeRegistry(configDir);
  if (Object.keys(registry.homes).length > 0) {
    const selection = selectHome(registry, requestedName, inputs.environment.LODE_HOME);
    await prepareHome(selection.path);
    return selection;
  }

  const selection = { name: requestedName ?? "main", path: join(configDir, "homes", requestedName ?? "main") };
  await prepareHome(selection.path);
  await writeHomeRegistry(configDir, (document) => {
    document["default_home"] = selection.name;
    document["homes"] = { [selection.name]: { path: selection.path } };
  });
  return selection;
}

async function prepareHome(path: string): Promise<void> {
  const existing = await statOrNull(path);
  if (existing !== null && !existing.isDirectory()) {
    throw new Error(`Lode Home path is not a directory: ${path}`);
  }
  const createdRoot = existing === null;
  if (createdRoot) {
    await mkdir(path, { recursive: true });
  }
  const entries = await readdir(path);
  const token = await textOrNull(join(path, "token"));
  const data = await statOrNull(join(path, "data"));
  if (token !== null && data?.isDirectory() === true) {
    return;
  }
  if (entries.length > 0) {
    throw new Error(`Directory is not empty and not a Lode Home (requires token and data/): ${path}`);
  }

  const dataPath = join(path, "data");
  try {
    await mkdir(dataPath);
    await writeFile(join(path, "token"), `${randomBytes(32).toString("hex")}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    await rollbackHomeInitialization(path, dataPath, createdRoot, error);
  }
}

async function rollbackHomeInitialization(
  root: string,
  dataPath: string,
  createdRoot: boolean,
  failure: unknown,
): Promise<never> {
  try {
    await rm(dataPath, { force: true, recursive: true });
    if (createdRoot) {
      await rm(root, { force: true, recursive: true });
    }
  } catch (cleanupError) {
    throw new AggregateError(
      [toError(failure), toError(cleanupError)],
      "Home initialization failed and did not roll back cleanly",
      { cause: cleanupError },
    );
  }
  throw toError(failure);
}

function argument(argv: readonly string[], flag: string): string | undefined {
  const inline = argv.find((value) => value.startsWith(`${flag}=`));
  if (inline !== undefined) {
    const value = inline.slice(flag.length + 1);
    if (value.length === 0) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  }
  const index = argv.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

async function statOrNull(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch (error) {
    if (hasCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

async function textOrNull(path: string): Promise<string | null> {
  try {
    const value = (await readFile(path, "utf8")).trim();
    return value.length > 0 ? value : null;
  } catch (error) {
    if (hasCode(error, "ENOENT")) {
      return null;
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
