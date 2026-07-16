/**
 * The dev-assertion hook for the workspace's loro single-writer discipline. Core write primitives
 * (the engine's mutator gate, the meta-doc's record append) consult it; the runtime's per-workspace
 * `RwWorkspaceLock` implements it.
 *
 * WHY THIS EXISTS: a workspace's loro docs are guarded by ONE read/write lock acquired at the
 * operation boundary (read → shared, write/import → exclusive). The primitives themselves do NOT
 * self-lock — they assume the caller already holds the appropriate lock (boundary locking, no
 * AsyncLocalStorage). That discipline is cheap to follow but easy to silently violate, so this hook
 * is the machine backstop: while only a SHARED lock is held, `assertWritable()` throws, turning "a
 * read path secretly writes loro" into a deterministic test failure instead of an intermittent
 * re-entrancy crash.
 *
 * Optional by design: core unit tests construct stores/engines/meta-docs without one, in which case
 * the assertion is absent (no-op). The runtime injects the workspace's `RwWorkspaceLock` so
 * production + the engine/daemon test suites get the backstop.
 */
export type LoroWriteGuard = {
  /** Throw iff no exclusive (write) lock is currently held on this workspace's docs. A no-op when a
   *  write IS authorized (an exclusive boundary is active). Called at write inlets only. */
  assertWritable(): void;
};
