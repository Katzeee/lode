import { CliError, errorOutcome, type CliOutcome, type CommandResult } from "./outcome/index.js";
import { renderHuman, renderJson, type Io } from "./output/index.js";

/**
 * Composition-owned render dispatch: finished outcomes and failures to
 * exit-code + renderer calls. The exit-code mapping is CLI policy, so it lives
 * with the composition, not inside the pure renderers.
 */

export function classify(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  const rawCode = (error as { code?: unknown }).code;
  const code = typeof rawCode === "string" ? rawCode : "";
  if (code === "unauthenticated" || /^\[unauthenticated\]/u.test(message)) {
    return new CliError("authorization", "The daemon rejected the access token.");
  }
  if (code === "permission_denied" || /^\[permission_denied\]/u.test(message)) {
    return new CliError("authorization", message);
  }
  if (code === "failed_precondition" || /^\[failed_precondition\]/u.test(message)) {
    return new CliError("conflict", message);
  }
  if (
    ["unavailable", "canceled", "deadline_exceeded"].includes(code) ||
    /^\[(?:unavailable|canceled|deadline_exceeded)\]/u.test(message)
  ) {
    return new CliError("transport", message);
  }
  return new CliError("internal", message);
}

export function renderResult(
  command: string,
  workspace: Readonly<{ workspaceId: string; label: string }> | null,
  result: CommandResult,
  format: "human" | "json",
  io: Io,
): number {
  const outcome: CliOutcome = {
    command,
    workspace: workspace === null ? null : { ref: `workspace:${workspace.workspaceId}`, label: workspace.label },
    status: result.status,
    data: result.data,
    page: result.page ?? null,
    view: result.view ?? null,
    error: result.error ?? null,
    warnings: result.warnings ?? [],
  };
  return dispatchRender(outcome, format, io, result.status === "outcome-unknown" ? 5 : 0);
}

export function renderFailure(
  error: CliError,
  options: Readonly<{
    command: string;
    workspace: Readonly<{ ref: string; label: string }> | null;
    io: Io;
    format?: "human" | "json";
  }>,
): number {
  const outcome: CliOutcome = {
    command: options.command,
    workspace: options.workspace,
    ...errorOutcome(error),
    view: null,
  };
  return dispatchRender(outcome, options.format ?? "human", options.io, error.exitCode);
}

function dispatchRender(outcome: CliOutcome, format: "human" | "json", io: Io, exitCode: number): number {
  const result = { outcome, exitCode };
  if (format === "json") {
    renderJson(result, io);
  } else {
    renderHuman(result, io);
  }
  return exitCode;
}

export function argvIncludesFormat(argv: readonly string[]): "human" | "json" | undefined {
  const index = argv.indexOf("--format");
  return index >= 0 && argv[index + 1] === "json" ? "json" : index >= 0 ? "human" : undefined;
}
