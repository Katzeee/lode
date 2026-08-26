import type { WriteResult, EngineError, EngineErrorCode } from "@lode/sdk";

/**
 * The single owner of CLI-visible failure and success semantics. Every
 * expected failure is a typed `CliError` with a stable code and exit code;
 * only program defects escape as unclassified errors and become `internal`.
 */

type CliErrorCode =
  | "usage"
  | "configuration-missing"
  | "target-not-found"
  | "ambiguous-target"
  | "invalid-value"
  | "unsupported"
  | "conflict"
  | "stale-selection"
  | "unavailable"
  | "authorization"
  | "transport"
  | "invocation-conflict"
  | "internal";

/** Candidate for `target-not-found` / `ambiguous-target` resolution hints. */
export type TargetCandidate = Readonly<{
  ref: string;
  link: string;
  label: string;
  parents: readonly string[];
}>;

export type CliErrorDetails = Readonly<Record<string, unknown>> & { engineCode?: EngineErrorCode };

export class CliError extends Error {
  readonly exitCode: 1 | 2 | 3 | 4;

  constructor(
    readonly code: CliErrorCode,
    message: string,
    options: Readonly<{
      exitCode?: 1 | 2 | 3 | 4;
      details?: CliErrorDetails;
      candidates?: readonly TargetCandidate[];
    }> = {},
  ) {
    super(message);
    this.exitCode = options.exitCode ?? exitCodeFor(code);
    this.details = options.details ?? {};
    this.candidates = options.candidates ?? [];
  }

  readonly details: CliErrorDetails;
  readonly candidates: readonly TargetCandidate[];
}

function exitCodeFor(code: CliErrorCode): 1 | 2 | 3 | 4 {
  switch (code) {
    case "usage":
    case "configuration-missing":
    case "target-not-found":
    case "ambiguous-target":
    case "invalid-value":
    case "unsupported":
      return 2;
    case "conflict":
    case "stale-selection":
    case "invocation-conflict":
      return 3;
    case "unavailable":
    case "authorization":
    case "transport":
      return 4;
    case "internal":
      return 1;
  }
}

type CliStatus = "ok" | "committed-pending" | "outcome-unknown" | "error";

export type CliPage = Readonly<{ count: number; next: string | null }>;

/**
 * Family-provided presentation view derived from the same command data the
 * JSON renderer serializes — the human renderer renders this instead of
 * re-reading the workspace.
 */
export type HumanView =
  | Readonly<{ kind: "text"; lines: readonly string[] }>
  | Readonly<{ kind: "table"; columns: readonly string[]; rows: readonly (readonly string[])[] }>;

/**
 * Structured, renderer-agnostic result of one command. `command` and
 * `workspace` are attached by the pipeline; families produce the rest.
 */
export type CliOutcome<Data = unknown> = Readonly<{
  command: string;
  workspace: Readonly<{ ref: string; label: string }> | null;
  status: CliStatus;
  data: Data | null;
  page: CliPage | null;
  view: HumanView | null;
  error: Readonly<{
    code: CliErrorCode | "outcome-unknown";
    message: string;
    details: CliErrorDetails;
    candidates: readonly TargetCandidate[];
  }> | null;
  warnings: readonly string[];
}>;

/** What a family handler returns; the pipeline attaches command/workspace. */
export type CommandResult<Data = unknown> = Readonly<{
  status: CliStatus;
  data: Data | null;
  page?: CliPage | null;
  view?: HumanView | null;
  error?: Readonly<{
    code: CliErrorCode | "outcome-unknown";
    message: string;
    details: CliErrorDetails;
    candidates: readonly TargetCandidate[];
  }> | null;
  warnings?: readonly string[];
}>;

export function okOutcome<Data>(
  data: Data,
  options: Readonly<{ page?: CliPage | null; view?: HumanView | null; warnings?: readonly string[] }> = {},
): CommandResult<Data> {
  return {
    status: "ok",
    data,
    page: options.page ?? null,
    view: options.view ?? null,
    error: null,
    warnings: options.warnings ?? [],
  };
}

/**
 * Standard human view for one completed write: a verb sentence plus the
 * affected resource's copyable ref and link.
 */
export function writeView(
  action: string,
  resource: Readonly<{ label: string; ref: string; link: string }>,
  to?: string,
): HumanView {
  return {
    kind: "text",
    lines: [
      `${action} ${resource.label}${to === undefined ? "" : ` ${to}`}`,
      `Ref: ${resource.ref}`,
      `Link: ${resource.link}`,
    ],
  };
}

export function errorOutcome(error: CliError): Readonly<{
  status: "error";
  data: null;
  page: null;
  error: Readonly<{
    code: CliErrorCode;
    message: string;
    details: CliErrorDetails;
    candidates: readonly TargetCandidate[];
  }>;
  warnings: readonly string[];
}> {
  return {
    status: "error",
    data: null,
    page: null,
    error: { code: error.code, message: error.message, details: error.details, candidates: error.candidates },
    warnings: [],
  };
}

/**
 * Classifies an Engine write result. `invalid-input` keeps its CLI code but is
 * a domain rejection, so it exits 3 — client-side value parsing exits 2 with
 * the same code before any request is made.
 */
export function engineWriteFailure(result: Extract<WriteResult, { status: "rejected" }>): CliError {
  return engineErrorToCli(result.error, 3);
}

export function engineQueryFailure(error: EngineError): CliError {
  return engineErrorToCli(error, 4);
}

function engineErrorToCli(error: EngineError, domainExit: 3 | 4): CliError {
  switch (error.code) {
    case "invalid-input":
      return new CliError("invalid-value", error.message, {
        exitCode: domainExit,
        details: { engineCode: error.code },
      });
    case "stale-selection":
      return new CliError("stale-selection", error.message, { exitCode: 3, details: { engineCode: error.code } });
    case "invocation-conflict":
      return new CliError("invocation-conflict", error.message, { exitCode: 3, details: { engineCode: error.code } });
    case "projection-unavailable":
    case "history-unavailable":
      return new CliError("unavailable", error.message, { exitCode: 4, details: { engineCode: error.code } });
    case "workspace-not-found":
      return new CliError("target-not-found", error.message, { exitCode: 4, details: { engineCode: error.code } });
    case "actor-locked":
    case "actor-not-member":
      return new CliError("configuration-missing", error.message, { exitCode: 3, details: { engineCode: error.code } });
  }
}
