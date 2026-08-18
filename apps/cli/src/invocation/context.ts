import { CliError } from "../outcome/index.js";
import type { GlobalOptions } from "./index.js";
import type { CommandDefinition } from "../catalog/index.js";
import type { DesktopSession } from "../session/index.js";

/** Everything a handler needs beyond its parsed arguments. */
export type CommandContext = Readonly<{
  session: DesktopSession;
  /** Null for workspace-management commands that select their own target. */
  workspace: Readonly<{ workspaceId: string; label: string }> | null;
  /** Raw --workspace selector, if given; there is no implicit workspace. */
  workspaceChoice: string | null;
  perspective: "origin" | "review";
  intent: "direct" | "proposal";
  requestId: string;
  limit: number;
  cursor?: string;
  persistence: WorkspacePersistence;
}>;

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

/** Consumer-owned persistence port; implemented by the configuration module. */
export type WorkspacePersistence = Readonly<{
  setSyncEndpoint(workspaceId: string, endpoint: string): Promise<void>;
  readSyncEndpoint(workspaceId: string): Promise<string | null>;
}>;
