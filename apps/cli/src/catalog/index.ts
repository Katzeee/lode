import type { CommandResult } from "../outcome/index.js";
import type { CommandContext, GlobalOptions, ParsedArgs } from "../invocation/index.js";

/**
 * Registry-driven command catalog. The same `CommandDefinition` records drive
 * dispatch, argument parsing, and help text — there is no second command list
 * and no central family/action switch.
 */

type OptionSpec = Readonly<{
  name: string;
  description: string;
  value?: Readonly<{ kind: "string" | "enum" | "file"; enum?: readonly string[] }>;
  repeatable?: boolean;
  required?: boolean;
  conflicts?: readonly string[];
}>;

type PositionalSpec = readonly [name: string, description: string] | readonly [string, string, "optional"];

type CommandMetadata = Readonly<{
  /** Command path, e.g. `["node", "create"]`. Globally unique. */
  readonly path: readonly string[];
  /** One-line user-facing summary for help. */
  readonly summary: string;
  /** Positional arguments in order. Third element "optional" marks an optional slot. */
  readonly positionals: readonly PositionalSpec[];
  /** Named action options. */
  readonly options: readonly OptionSpec[];
  /** Read commands reject `--intent`; non-paginated commands reject `--cursor`. */
  readonly kind: "read" | "write";
  readonly paginated: boolean;
  /**
   * Knowledge-model commands run against the explicit --workspace target;
   * workspace-management commands resolve their own targets and may run with
   * none selected.
   */
  readonly needsWorkspace: boolean;
}>;

export type ManagementCommandContext = Readonly<{
  globals: GlobalOptions;
  environment: Readonly<Record<string, string | undefined>>;
  configDir: string;
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

export class CommandCatalog {
  private readonly definitions = new Map<string, CommandDefinition>();

  register(definition: CommandDefinition): void {
    const key = pathKey(definition.path);
    if (this.definitions.has(key)) {
      throw new Error(`Duplicate command path: ${definition.path.join(" ")}`);
    }
    this.definitions.set(key, definition);
  }

  resolve(path: readonly string[]): CommandDefinition | undefined {
    return this.definitions.get(pathKey(path));
  }

  families(): readonly string[] {
    const families = [...new Set([...this.definitions.keys()].map((key) => key.split(" ")[0] ?? ""))];
    return families.filter((family) => family.length > 0).sort();
  }

  byFamily(family: string): readonly CommandDefinition[] {
    return [...this.definitions.values()]
      .filter((definition) => definition.path[0] === family)
      .sort((left, right) => pathKey(left.path).localeCompare(pathKey(right.path)));
  }

  all(): readonly CommandDefinition[] {
    return [...this.definitions.values()].sort((left, right) => pathKey(left.path).localeCompare(pathKey(right.path)));
  }

  rootHelp(): string {
    const lines = [
      "Usage: lode [global-options] <family> <action> [primary-target] [action-options]",
      "",
      "Command families:",
    ];
    for (const family of this.families()) {
      const actions = this.byFamily(family)
        .map((definition) => subPath(definition.path))
        .join(", ");
      lines.push(`  ${family} — ${actions}`);
    }
    lines.push(
      "",
      "Global options:",
      "  --home <name>          Select the Lode Home for this invocation",
      "  --workspace <target>   Select the Workspace for knowledge commands",
      "  --perspective origin|review   Read perspective (default origin)",
      "  --intent direct|proposal      Write intent (default direct)",
      "  --format human|json           Output format (default human)",
      "  --request-id <id>             Caller-supplied idempotency key",
      "  --limit <1..99>               Page size for bounded reads (default 50)",
      "  --cursor <cursor>             Continue a previous page",
      "",
      `Run 'lode <family> --help' or 'lode <family> <action> --help' for details.`,
    );
    return lines.join("\n");
  }

  help(definition: CommandDefinition): string {
    const usage = [`lode ${definition.path.join(" ")}`];
    for (const positional of definition.positionals) {
      usage.push(`<${positional[0]}>`);
    }
    const lines = [usage.join(" "), "", definition.summary];
    if (definition.positionals.length > 0) {
      lines.push("", "Arguments:");
      for (const positional of definition.positionals) {
        lines.push(`  <${positional[0]}>   ${positional[1]}${positional[2] === "optional" ? " (optional)" : ""}`);
      }
    }
    if (definition.options.length > 0) {
      lines.push("", "Options:");
      for (const option of definition.options) {
        const shape =
          option.value === undefined
            ? option.name
            : `${option.name} <${option.value.kind === "enum" ? (option.value.enum ?? []).join("|") : option.value.kind}>`;
        const notes = [
          option.required === true ? "required" : "",
          option.repeatable === true ? "repeatable" : "",
          option.conflicts ? `conflicts with ${option.conflicts.join(", ")}` : "",
        ].filter((note) => note.length > 0);
        lines.push(`  ${shape}${notes.length > 0 ? ` (${notes.join("; ")})` : ""}   ${option.description}`);
      }
    }
    return lines.join("\n");
  }
}

function pathKey(path: readonly string[]): string {
  return path.join(" ");
}

function subPath(path: readonly string[]): string {
  return path.slice(1).join(" ");
}
