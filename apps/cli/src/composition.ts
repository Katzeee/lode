import { readFile } from "node:fs/promises";

import {
  ensureRunningDaemon,
  HomeConfigurationError,
  lodeConfigDir,
  readHomeRegistry,
  registryFile,
  selectHome,
} from "@lode/desktop-client";

import { CliError, type TargetCandidate } from "./outcome/index.js";
import { argvIncludesFormat, classify, renderFailure, renderResult } from "./rendering.js";
import { CommandCatalog } from "./catalog/index.js";
import { decodeInvocation, validateGlobalsFor, type InputFileReader, type Invocation } from "./invocation/index.js";
import {
  readCliPreferences,
  readSyncEndpoint,
  readWorkspaceActor,
  setSyncEndpoint,
  setWorkspaceActor,
} from "./config/index.js";
import { openSession } from "./session/index.js";
import type { Io } from "./output/index.js";
import { resolveWorkspaceFromList } from "./target/index.js";
import { registerWorkspaceCommands } from "./families/workspace.js";
import { registerWorkspaceGovernanceCommands } from "./families/workspace-governance.js";
import { registerNodeCommands } from "./families/node.js";
import { registerReferenceCommands } from "./families/reference.js";
import { registerSupertagCommands } from "./families/supertag.js";
import { registerFieldCommands } from "./families/field.js";
import { registerSearchCommands } from "./families/search.js";
import { registerViewCommands } from "./families/view.js";
import { registerHistoryCommands } from "./families/history.js";
import { registerReviewCommands } from "./families/review.js";
import { registerSyncCommands } from "./families/sync.js";
import { registerIdentityCommands } from "./families/identity.js";
import { daemonCommands } from "./manage/daemon.js";
import { homeCommands } from "./manage/home.js";
import { launchDaemon } from "./daemon-launch.js";
import { runDiagnosticCli } from "./diagnostics/index.js";

export const CLI_VERSION = "0.1.0";

const DIAGNOSTIC_COMMANDS = new Set(["execute", "query"]);

/**
 * Composition root: the only place that knows every module. It builds the
 * catalog, resolves the home and connection, owns the session lifecycle,
 * dispatches one command, and hands a finished outcome to the renderers.
 */

export type ProcessInputs = Readonly<{
  argv: readonly string[];
  environment: Readonly<Record<string, string | undefined>>;
  platform: string;
  io: Io;
}>;

export function buildCatalog(): CommandCatalog {
  const catalog = new CommandCatalog();
  for (const register of [
    registerWorkspaceCommands,
    registerWorkspaceGovernanceCommands,
    registerIdentityCommands,
    registerNodeCommands,
    registerReferenceCommands,
    registerSupertagCommands,
    registerFieldCommands,
    registerSearchCommands,
    registerViewCommands,
    registerHistoryCommands,
    registerReviewCommands,
    registerSyncCommands,
  ]) {
    register(catalog);
  }
  for (const definition of [...homeCommands(), ...daemonCommands()]) {
    catalog.register(definition);
  }
  return catalog;
}

export async function runLode(inputs: ProcessInputs): Promise<number> {
  const { argv, environment, io } = inputs;
  const first = argv[0];
  if (first !== undefined && DIAGNOSTIC_COMMANDS.has(first)) {
    try {
      await runDiagnosticCli(argv, (text) => io.stdout(text), environment);
      return 0;
    } catch (error) {
      io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }

  const catalog = buildCatalog();
  let invocation: Invocation;
  try {
    invocation = await decodeInvocation(argv, catalog, fileReader());
  } catch (error) {
    return renderFailure(classify(error), {
      command: commandPathOf(argv),
      workspace: null,
      io,
      format: argvIncludesFormat(argv),
    });
  }

  if (invocation.kind === "version") {
    io.stdout(`${CLI_VERSION}\n`);
    return 0;
  }
  if (invocation.kind === "help") {
    io.stdout(`${catalog.rootHelp()}\n`);
    return 0;
  }
  if (invocation.kind === "family-help") {
    const lines = [`Usage: lode ${invocation.family} <action> [arguments]`, ""];
    for (const definition of catalog.byFamily(invocation.family)) {
      lines.push(`  ${definition.path.slice(1).join(" ")} — ${definition.summary}`);
    }
    io.stdout(`${lines.join("\n")}\n`);
    return 0;
  }
  if (invocation.kind === "action-help") {
    io.stdout(`${catalog.help(invocation.definition)}\n`);
    return 0;
  }

  const { definition, globals, args } = invocation;
  const command = definition.path.join(".");
  const configDir = environment.LODE_CONFIG_DIR ?? lodeConfigDir();
  try {
    validateGlobalsFor(definition, globals);
    const preferences = await readCliPreferences(registryFile(configDir));
    const format = globals.format ?? preferences.defaultFormat ?? "human";

    if (definition.runManagement !== undefined) {
      const result = await definition.runManagement({ globals, environment, configDir }, args);
      return renderResult(command, null, result, format, io);
    }

    const selection = selectHome(await readHomeRegistry(configDir), globals.home, environment.LODE_HOME);
    const client = await ensureRunningDaemon(selection, launchDaemon);
    const session = openSession(client);
    try {
      const workspaceChoice = globals.workspace ?? null;
      let workspace: Readonly<{ workspaceId: string; label: string }> | null = null;
      if (definition.needsWorkspace) {
        const workspaces = await session.workspaces.list();
        if (workspaceChoice === null) {
          throw missingWorkspace(workspaces);
        }
        workspace = resolveWorkspaceFromList(workspaces, workspaceChoice);
      }
      const selectedActor =
        globals.actor ?? (workspace === null ? null : await readWorkspaceActor(selection.path, workspace.workspaceId));
      const result = await definition.run(
        {
          session,
          workspace,
          workspaceChoice,
          perspective: globals.perspective ?? "origin",
          intent: globals.intent ?? "direct",
          requestId: globals.requestId ?? `cli-${crypto.randomUUID()}`,
          limit: globals.limit ?? preferences.defaultLimit ?? 50,
          cursor: globals.cursor,
          actor: selectedActor,
          persistence: {
            setSyncEndpoint: (workspaceId, endpoint) => setSyncEndpoint(selection.path, workspaceId, endpoint),
            readSyncEndpoint: (workspaceId) => readSyncEndpoint(selection.path, workspaceId),
            setWorkspaceActor: (workspaceId, actorId) => setWorkspaceActor(selection.path, workspaceId, actorId),
            readWorkspaceActor: (workspaceId) => readWorkspaceActor(selection.path, workspaceId),
          },
        },
        args,
      );
      return renderResult(command, workspace, result, format, io);
    } finally {
      session.close();
    }
  } catch (error) {
    const classified =
      error instanceof HomeConfigurationError ? new CliError("configuration-missing", error.message) : classify(error);
    return renderFailure(classified, { command, workspace: null, io, format: globals.format ?? "human" });
  }
}

/** A knowledge command without --workspace fails with copyable candidates. */
function missingWorkspace(workspaces: readonly Readonly<{ workspaceId: string; label: string }>[]): CliError {
  const candidates: TargetCandidate[] = workspaces.map((workspace) => ({
    ref: `workspace:${workspace.workspaceId}`,
    link: `lode://${workspace.workspaceId}`,
    label: workspace.label,
    parents: [],
  }));
  return new CliError(
    "configuration-missing",
    candidates.length === 0
      ? "No --workspace given and this home has no workspaces. Create one with `lode workspace create <name>`."
      : "No --workspace given. Pass one of the listed workspaces or create one with `lode workspace create <name>`.",
    { candidates },
  );
}

function fileReader(): InputFileReader {
  return {
    readFile: (path) => readFile(path, "utf8"),
    readStdin: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
      }
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}

function commandPathOf(argv: readonly string[]): string {
  return argv
    .filter((token) => !token.startsWith("-"))
    .slice(0, 3)
    .join(".");
}
