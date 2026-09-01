import { CliError, type CommandResult } from "../outcome/index.js";
import type { DesktopSession } from "../session/index.js";

export type GlobalOptions = Readonly<{
  home?: string;
  workspace?: string;
  actor?: string;
  perspective?: "origin" | "review";
  intent?: "direct" | "proposal";
  format?: "human" | "json";
  requestId?: string;
  limit?: number;
  cursor?: string;
}>;

export type CommandContext = Readonly<{
  session: DesktopSession;
  workspace: Readonly<{ workspaceId: string; label: string }> | null;
  workspaceChoice: string | null;
  perspective: "origin" | "review";
  intent: "direct" | "proposal";
  requestId: string;
  limit: number;
  cursor?: string;
  actor: string | null;
  persistence: WorkspacePersistence;
}>;

export type ManagementCommandContext = Readonly<{
  globals: GlobalOptions;
  environment: Readonly<Record<string, string | undefined>>;
  configDir: string;
}>;

type OptionSpec = Readonly<{
  name: string;
  description: string;
  value?: Readonly<{ kind: "string" | "enum" | "file"; enum?: readonly string[] }>;
  repeatable?: boolean;
  required?: boolean;
  conflicts?: readonly string[];
}>;

type OptionExtras = Partial<Pick<OptionSpec, "repeatable" | "required" | "conflicts">>;

export function stringOption(name: string, description: string, extras: OptionExtras = {}): OptionSpec {
  return { name, description, value: { kind: "string" }, ...extras };
}

export function enumOption(
  name: string,
  values: readonly string[],
  description: string,
  extras: OptionExtras = {},
): OptionSpec {
  return { name, description, value: { kind: "enum", enum: values }, ...extras };
}

export function fileOption(name: string, description: string, extras: OptionExtras = {}): OptionSpec {
  return { name, description, value: { kind: "file" }, ...extras };
}

export function flagOption(name: string, description: string, extras: OptionExtras = {}): OptionSpec {
  return { name, description, ...extras };
}

type PositionalSpec = readonly [name: string, description: string] | readonly [string, string, "optional"];

type CommandMetadata = Readonly<{
  readonly path: readonly string[];
  readonly summary: string;
  readonly positionals: readonly PositionalSpec[];
  readonly options: readonly OptionSpec[];
  readonly kind: "read" | "write";
  readonly paginated: boolean;
  readonly needsWorkspace: boolean;
}>;

export type ProductCommandRun = (context: CommandContext, args: ParsedArgs) => Promise<CommandResult>;

export type CommandDefinition = CommandMetadata &
  (
    | Readonly<{
        run: ProductCommandRun;
        runManagement?: never;
      }>
    | Readonly<{
        run?: never;
        runManagement: (context: ManagementCommandContext, args: ParsedArgs) => Promise<CommandResult>;
      }>
  );

type WorkspaceCommandShape = Readonly<{
  path: readonly string[];
  summary: string;
  positionals?: readonly PositionalSpec[];
  options?: readonly OptionSpec[];
  paginated?: boolean;
  needsWorkspace?: boolean;
  run: ProductCommandRun;
}>;

/** A knowledge-model command; workspace-bound and unpaginated unless the shape says otherwise. */
export function writeCommand(shape: WorkspaceCommandShape): CommandDefinition {
  return workspaceCommand("write", shape);
}

export function readCommand(shape: WorkspaceCommandShape): CommandDefinition {
  return workspaceCommand("read", shape);
}

function workspaceCommand(kind: "read" | "write", shape: WorkspaceCommandShape): CommandDefinition {
  return {
    positionals: [],
    options: [],
    paginated: false,
    needsWorkspace: true,
    kind,
    ...shape,
  };
}

export function validateGlobalsFor(definition: CommandDefinition, globals: GlobalOptions): void {
  if (definition.kind === "read" && globals.intent !== undefined) {
    throw new CliError("usage", `${definition.path.join(" ")} is a read command and does not accept --intent`);
  }
  if (!definition.paginated && globals.cursor !== undefined) {
    throw new CliError("usage", `${definition.path.join(" ")} is not paginated and does not accept --cursor`);
  }
}

export class ParsedArgs {
  constructor(
    private readonly positionalValues: ReadonlyMap<string, string>,
    private readonly optionValues: ReadonlyMap<string, readonly string[]>,
  ) {}

  static empty(): ParsedArgs {
    return new ParsedArgs(new Map(), new Map());
  }

  positional(name: string): string {
    const value = this.positionalValues.get(name);
    if (value === undefined) {
      throw new CliError("usage", `Missing <${name}> argument`);
    }
    return value;
  }

  optionalPositional(name: string): string | undefined {
    return this.positionalValues.get(name);
  }

  option(name: string): string | undefined {
    return this.optionValues.get(name)?.at(0);
  }

  requiredOption(name: string): string {
    const value = this.option(name);
    if (value === undefined) {
      throw new CliError("usage", `Missing required option ${name}`);
    }
    return value;
  }

  many(name: string): readonly string[] {
    return this.optionValues.get(name) ?? [];
  }

  has(name: string): boolean {
    return this.optionValues.has(name);
  }
}

type WorkspacePersistence = Readonly<{
  setSyncEndpoint(workspaceId: string, endpoint: string): Promise<void>;
  readSyncEndpoint(workspaceId: string): Promise<string | null>;
  setWorkspaceActor(workspaceId: string, actorId: string): Promise<void>;
  readWorkspaceActor(workspaceId: string): Promise<string | null>;
}>;
