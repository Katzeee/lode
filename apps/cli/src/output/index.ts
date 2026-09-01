import type { CliOutcome, HumanView } from "../outcome/index.js";

/**
 * Pure rendering of one finished command outcome. Renderers never query the
 * engine, resolve targets, or re-derive state; JSON and human output come
 * from the same completed outcome. stdout carries only the result; human
 * errors and diagnostics go to stderr.
 */

/** The full renderable result of one invocation. */
type RenderedOutcome = Readonly<{
  outcome: CliOutcome;
  exitCode: number;
}>;

export type Io = Readonly<{
  stdout(text: string): void;
  stderr(text: string): void;
}>;

export function renderJson(result: RenderedOutcome, io: Io): void {
  const { outcome } = result;
  const envelope: Record<string, unknown> = {
    version: 1,
    command: outcome.command,
    workspace: outcome.workspace,
    status: outcome.status,
    data: outcome.data,
    page: outcome.page,
    error: outcome.error,
    warnings: outcome.warnings,
  };
  io.stdout(`${JSON.stringify(envelope)}\n`);
}

export function renderHuman(result: RenderedOutcome, io: Io): void {
  const { outcome } = result;
  if (outcome.status === "error" && outcome.error !== null) {
    renderHumanError(outcome, io);
    return;
  }
  if (outcome.view !== null) {
    io.stdout(renderView(outcome.view));
  } else {
    io.stdout(humanStatusLine(outcome));
  }
  for (const warning of outcome.warnings) {
    io.stdout(`${warning}\n`);
  }
  if (outcome.page?.next != null) {
    io.stdout(`Next page: repeat the command with --cursor ${outcome.page.next}\n`);
  }
  if (outcome.status === "outcome-unknown") {
    io.stderr(
      "The write was committed but its outcome could not be confirmed. Query it with the request id before retrying.\n",
    );
  }
}

function renderView(view: HumanView): string {
  if (view.kind === "text") {
    return view.lines.length === 0 ? "" : `${view.lines.join("\n")}\n`;
  }
  if (view.rows.length === 0) {
    return `${view.columns.join("\t")}\n`;
  }
  const widths = view.columns.map((column, index) =>
    Math.max(column.length, ...view.rows.map((row) => (row[index] ?? "").length)),
  );
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, index) => (cell ?? "").padEnd(widths[index] ?? 0))
      .join("  ")
      .trimEnd();
  return `${[line(view.columns), ...view.rows.map(line)].join("\n")}\n`;
}

function humanStatusLine(outcome: CliOutcome): string {
  switch (outcome.status) {
    case "ok":
      return "Done.\n";
    case "committed-pending":
      return "Committed. The projection is still updating; read it again in a moment.\n";
    case "outcome-unknown":
      return "Committed, but the outcome is unknown. Query the request id before retrying.\n";
    case "error":
      return "";
  }
}

function renderHumanError(outcome: CliOutcome, io: Io): void {
  if (outcome.error === null) {
    return;
  }
  const { error } = outcome;
  io.stderr(`Error [${error.code}]: ${error.message}\n`);
  for (const candidate of error.candidates) {
    const parents = candidate.parents.length > 0 ? ` (under ${candidate.parents.join(" / ")})` : "";
    io.stderr(`  Candidate: ${candidate.ref} — ${candidate.label}${parents}\n`);
    io.stderr(`  Link: ${candidate.link}\n`);
  }
  io.stderr(fixHint(error.code));
}

function fixHint(code: NonNullable<CliOutcome["error"]>["code"]): string {
  switch (code) {
    case "usage":
      return "Run the command with --help for its accepted arguments.\n";
    case "configuration-missing":
      return "Configure an endpoint and access token, or pass --endpoint and LODE_ACCESS_TOKEN.\n";
    case "target-not-found":
      return "Use an exact label, a typed ref, or a canonical link from previous output.\n";
    case "ambiguous-target":
      return "Pass the typed ref of the intended candidate, or narrow with --under/--on/--from.\n";
    case "invalid-value":
      return "Check the value against the field's datatype and cardinality.\n";
    case "stale-selection":
      return "The evidence moved on. Re-run the listing command and use a fresh selector.\n";
    case "unsupported":
    case "conflict":
    case "unavailable":
    case "authorization":
    case "transport":
    case "invocation-conflict":
    case "outcome-unknown":
    case "internal":
      return "";
  }
}
