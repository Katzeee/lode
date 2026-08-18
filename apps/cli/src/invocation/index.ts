import { CliError } from "../outcome/index.js";
import type { CommandDefinition } from "../catalog/index.js";
import { ParsedArgs } from "./context.js";
export { ParsedArgs, validateGlobalsFor } from "./context.js";
export type { CommandContext, WorkspacePersistence } from "./context.js";

/**
 * Invocation decoding: argv in, syntactically valid typed input out. No
 * dialing, no target lookup, no workspace defaults — those belong to later
 * pipeline stages. Usage failures are typed `CliError`s, never strings.
 */

export const GLOBAL_OPTIONS = [
  "--home",
  "--workspace",
  "--perspective",
  "--intent",
  "--format",
  "--request-id",
  "--limit",
  "--cursor",
] as const;

export type GlobalOptions = Readonly<{
  home?: string;
  workspace?: string;
  perspective?: "origin" | "review";
  intent?: "direct" | "proposal";
  format?: "human" | "json";
  requestId?: string;
  limit?: number;
  cursor?: string;
}>;

export type Invocation =
  | Readonly<{ kind: "version" }>
  | Readonly<{ kind: "help" }>
  | Readonly<{ kind: "family-help"; family: string }>
  | Readonly<{ kind: "action-help"; definition: CommandDefinition }>
  | Readonly<{ kind: "command"; definition: CommandDefinition; globals: GlobalOptions; args: ParsedArgs }>;

/** Reads option values declared as files; `-` is the only explicit stdin form. */
export type InputFileReader = Readonly<{
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
}>;

const PERSPECTIVES = ["origin", "review"] as const;
const INTENTS = ["direct", "proposal"] as const;
const FORMATS = ["human", "json"] as const;

export type CommandLookup = Readonly<{
  resolve(path: readonly string[]): CommandDefinition | undefined;
  families(): readonly string[];
}>;

export async function decodeInvocation(
  argv: readonly string[],
  lookup: CommandLookup,
  files: InputFileReader,
): Promise<Invocation> {
  const { globals, rest, error } = takeGlobalOptions(argv);
  if (error !== undefined) {
    throw new CliError("usage", error);
  }
  if (rest.length === 0) {
    if (globals.version) {
      return { kind: "version" };
    }
    return globals.help ? { kind: "help" } : { kind: "version" };
  }
  if (rest[0] === "help" && rest.length === 1) {
    return { kind: "help" };
  }
  const family = rest[0];
  if (family === undefined || !lookup.families().includes(family)) {
    throw new CliError("usage", `Unknown command family: ${family}`);
  }
  if (rest.length === 1) {
    return { kind: "family-help", family };
  }
  const action = rest[1] ?? "";
  const tail = rest.slice(2);
  if (rest.some((token) => token === "--help" || token === "-h")) {
    const words = tail.filter((token) => token !== "--help" && token !== "-h" && !token.startsWith("--"));
    const definition = lookup.resolve([family, action, ...words]);
    return definition === undefined ? { kind: "family-help", family } : { kind: "action-help", definition };
  }
  const matched = matchCommandPath(lookup, [family, action], tail);
  if (matched.definition === undefined) {
    throw new CliError("usage", `Unknown command: ${[family, action, ...matched.words].join(" ")}`);
  }
  const { definition, positionalsAndOptions } = matched;
  const parsed = await parseDefinitionArgs(definition, positionalsAndOptions, files);
  if (parsed.help) {
    return { kind: "action-help", definition };
  }
  return { kind: "command", definition, globals: stripHelp(globals), args: parsed.args };
}

/**
 * Command paths longer than family+action (`supertag field add-new`,
 * `view column add`) are matched by the longest prefix of leading non-option
 * words that resolves to a registered command; the remaining words become the
 * command's positional arguments.
 */
function matchCommandPath(
  lookup: CommandLookup,
  start: readonly string[],
  tail: readonly string[],
): Readonly<{ definition?: CommandDefinition; words: readonly string[]; positionalsAndOptions: readonly string[] }> {
  const words: string[] = [];
  for (const token of tail) {
    if (token.startsWith("-")) {
      break;
    }
    words.push(token);
  }
  for (let length = words.length; length >= 0; length -= 1) {
    const definition = lookup.resolve([...start, ...words.slice(0, length)]);
    if (definition !== undefined) {
      return { definition, words, positionalsAndOptions: tail.slice(length) };
    }
  }
  return { words, positionalsAndOptions: tail };
}

function takeGlobalOptions(
  argv: readonly string[],
): Readonly<{ globals: GlobalOptions & { help: boolean; version: boolean }; rest: readonly string[]; error?: string }> {
  const values = new Map<string, string>();
  let help = false;
  let version = false;
  let index = 0;
  for (; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      help = true;
      continue;
    }
    if (token === "--version") {
      version = true;
      continue;
    }
    const name = GLOBAL_OPTIONS.find((option) => option === token);
    if (name === undefined) {
      break;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      return { globals: baseGlobals(values, help, version), rest: [], error: `${name} requires a value` };
    }
    values.set(name, value);
    index += 1;
  }
  return { globals: baseGlobals(values, help, version), rest: argv.slice(index) };
}

function baseGlobals(
  values: ReadonlyMap<string, string>,
  help: boolean,
  version: boolean,
): GlobalOptions & { help: boolean; version: boolean } {
  const read = (name: string): string | undefined => values.get(name);
  const enumerated = (name: string, allowed: readonly string[]): string | undefined => {
    const value = read(name);
    if (value !== undefined && !allowed.includes(value)) {
      throw new CliError("usage", `${name} must be one of: ${allowed.join(", ")}`);
    }
    return value;
  };
  const globals: Record<string, unknown> = { help, version };
  const set = (key: string, value: unknown): void => {
    if (value !== undefined) {
      globals[key] = value;
    }
  };
  set("home", read("--home"));
  set("workspace", read("--workspace"));
  set("perspective", enumerated("--perspective", PERSPECTIVES));
  set("intent", enumerated("--intent", INTENTS));
  set("format", enumerated("--format", FORMATS));
  set("requestId", read("--request-id"));
  const limit = read("--limit");
  if (limit !== undefined) {
    const parsed = Number.parseInt(limit, 10);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 99) {
      throw new CliError("usage", "--limit must be an integer between 1 and 99");
    }
    set("limit", parsed);
  }
  set("cursor", read("--cursor"));
  return globals as GlobalOptions & { help: boolean; version: boolean };
}

function stripHelp(globals: GlobalOptions & { help: boolean; version: boolean }): GlobalOptions {
  const { help: _help, version: _version, ...rest } = globals;
  return rest;
}

async function parseDefinitionArgs(
  definition: CommandDefinition,
  tokens: readonly string[],
  files: InputFileReader,
): Promise<Readonly<{ args: ParsedArgs; help: boolean }>> {
  const positionalValues = new Map<string, string>();
  const optionValues = new Map<string, string[]>();
  const optionByName = new Map(definition.options.map((option) => [option.name, option]));
  let index = 0;
  let nextPositional = 0;

  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    if (token === "--help" || token === "-h") {
      return { args: ParsedArgs.empty(), help: true };
    }
    if (!token.startsWith("--")) {
      const slot = definition.positionals[nextPositional];
      if (slot === undefined) {
        throw new CliError("usage", `Unexpected positional argument: ${String(token)}`);
      }
      positionalValues.set(slot[0], token);
      nextPositional += 1;
      index += 1;
      continue;
    }
    const option = optionByName.get(token);
    if (option === undefined) {
      throw new CliError("usage", `Unknown option for ${definition.path.join(" ")}: ${token}`);
    }
    if (option.value === undefined) {
      optionValues.set(option.name, [...(optionValues.get(option.name) ?? []), ""]);
      index += 1;
      continue;
    }
    const raw = tokens[index + 1];
    if (raw === undefined || raw.startsWith("--")) {
      throw new CliError("usage", `${option.name} requires a value`);
    }
    if (option.value.kind === "enum" && !(option.value.enum ?? []).includes(raw)) {
      throw new CliError("usage", `${option.name} must be one of: ${(option.value.enum ?? []).join(", ")}`);
    }
    const value = option.value.kind === "file" ? await readFileInput(raw, option.name, files) : raw;
    const existing = optionValues.get(option.name) ?? [];
    if (existing.length > 0 && option.repeatable !== true) {
      throw new CliError("usage", `${option.name} was provided more than once`);
    }
    existing.push(value);
    optionValues.set(option.name, existing);
    index += 2;
  }

  for (const slot of definition.positionals) {
    const [name, , optional] = slot;
    if (optional !== "optional" && !positionalValues.has(name)) {
      throw new CliError("usage", `${definition.path.join(" ")} requires <${name}>`);
    }
  }
  for (const option of definition.options) {
    if (option.required === true && (optionValues.get(option.name) ?? []).length === 0) {
      throw new CliError("usage", `${definition.path.join(" ")} requires ${option.name}`);
    }
    for (const conflict of option.conflicts ?? []) {
      if ((optionValues.get(option.name) ?? []).length > 0 && (optionValues.get(conflict) ?? []).length > 0) {
        throw new CliError("usage", `${option.name} and ${conflict} are mutually exclusive`);
      }
    }
  }
  return { args: new ParsedArgs(positionalValues, optionValues), help: false };
}

async function readFileInput(raw: string, name: string, files: InputFileReader): Promise<string> {
  if (raw === "-") {
    return files.readStdin();
  }
  try {
    return await files.readFile(raw);
  } catch (error) {
    throw new CliError(
      "usage",
      `${name} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      {
        details: { path: raw },
      },
    );
  }
}
