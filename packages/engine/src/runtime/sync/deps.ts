/** Round-summary shape the engine emits each content round; the host decides the UX. */
export type RoundSummary = { readonly pulled: number; readonly pushed: number };

/**
 * Host-injected policy hooks the engine-owned sync needs to stay business-agnostic — the
 * lode analog of any-sync's `commonspace.Deps`, narrowed to the MVP surface. All optional: the
 * defaults are sensible so an in-process host (tests, embedded, mobile) pays nothing. The engine
 * owns the sync composition; the product layer injects policy through this narrow seam.
 */
export type SyncDeps = {
  /** Round-summary reporter. Default: a rate-limited logger (always logs when ops were exchanged;
   *  ~1 idle line per workspace per ~200s). The engine emits raw counts; the host shapes the UX
   *  (CLI log line, mobile toast, nothing). */
  readonly onRound?: (workspaceId: string, summary: RoundSummary) => void;
};
