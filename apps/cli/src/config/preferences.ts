import { readFile } from "node:fs/promises";

import { parse } from "smol-toml";

import { CliError } from "../outcome/index.js";

type CliPreferences = Readonly<{
  defaultFormat?: "human" | "json";
  defaultLimit?: number;
}>;

export async function readCliPreferences(configFile: string): Promise<CliPreferences> {
  let text: string;
  try {
    text = await readFile(configFile, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      return {};
    }
    throw new CliError("configuration-missing", `Cannot read lode.toml: ${describe(error)}`);
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

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
