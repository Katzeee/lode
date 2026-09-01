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
import { validateGlobalsFor } from "./command/index.js";
import { decodeInvocation, type InputFileReader, type Invocation } from "./invocation/index.js";
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
import { launchDaemon } from "./manage/daemon-launch.js";
import { createProductCatalog } from "./product-catalog.js";

const CLI_VERSION = "0.1.0";

/**
 * Composition root: the only place that knows every module. It builds the
 * catalog, resolves the home and connection, owns the session lifecycle,
 * dispatches one command, and hands a finished outcome to the renderers.
 */

type ProcessInputs = Readonly<{
  argv: readonly string[];
  environment: Readonly<Record<string, string | undefined>>;
  platform: string;
  io: Io;
}>;

export async function runLode(inputs: ProcessInputs): Promise<number> {
  const { argv, environment, io } = inputs;
  const catalog = createProductCatalog();
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
  let failureFormat = globals.format ?? "human";
  let failureWorkspace: Readonly<{ ref: string; label: string }> | null = null;
  try {
    validateGlobalsFor(definition, globals);
    const preferences = await readCliPreferences(registryFile(configDir));
    const format = globals.format ?? preferences.defaultFormat ?? "human";
    failureFormat = format;

    if (definition.runManagement !== undefined) {
      const result = await definition.runManagement({ globals, environment, configDir }, args);
      return renderResult(command, null, result, format, io);
    }

    const selection = selectHome(await readHomeRegistry(configDir), globals.home, environment.LODE_HOME);
    const client = await ensureRunningDaemon(selection, launchDaemon);
    const session = openSession(client);
    return await withSession(session, async () => {
      const workspaceChoice = globals.workspace ?? null;
      let workspace: Readonly<{ workspaceId: string; label: string }> | null = null;
      if (definition.needsWorkspace) {
        const workspaces = await session.workspaces.list();
        if (workspaceChoice === null) {
          throw missingWorkspace(workspaces);
        }
        workspace = resolveWorkspaceFromList(workspaces, workspaceChoice);
        failureWorkspace = { ref: `workspace:${workspace.workspaceId}`, label: workspace.label };
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
    });
  } catch (error) {
    const classified =
      error instanceof HomeConfigurationError ? new CliError("configuration-missing", error.message) : classify(error);
    return renderFailure(classified, { command, workspace: failureWorkspace, io, format: failureFormat });
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

async function withSession<Result>(
  session: Readonly<{ close(): void }>,
  operation: () => Promise<Result>,
): Promise<Result> {
  let result: Result;
  try {
    result = await operation();
  } catch (error) {
    try {
      session.close();
    } catch (cleanupError) {
      const failure = new AggregateError(
        [toError(error), toError(cleanupError)],
        "CLI command and session cleanup failed",
        {
          cause: error,
        },
      );
      throw failure;
    }
    throw error;
  }
  session.close();
  return result;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
