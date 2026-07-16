import type { LoroWriteGuard } from "../../core/store/write-guard.js";

/**
 * The per-workspace lock over ALL of a workspace's loro docs — tree + 256 shards + membership
 * metaDoc + workspace_meta. One lock per workspace (not per-doc: multi-doc ops are fast,
 * pseudo-contention is acceptable, and per-doc locks risk cross-doc deadlock). Different workspaces
 * carry different locks, so they run fully in parallel.
 *
 * BOUNDARY LOCKING — the primitives do NOT self-lock. Callers acquire at the operation boundary:
 *   - a read (`WorkspaceRuntime.run`, sync export stages) acquires SHARED — many readers at once,
 *     and no writer can slip in between two reads, so a read sees a consistent snapshot;
 *   - a write/import (`runExclusive`, sync import stages) acquires EXCLUSIVE — one writer, atomic.
 * Because the primitives never acquire the lock themselves, there is no nested-self-lock deadlock
 * and no need for AsyncLocalStorage to carry a re-entry token. The cost is a discipline point: every
 * loro touch that does not go through `run`/`runExclusive` (i.e. sync) must acquire at its own
 * boundary. That discipline is concentrated in one place (sync).
 *
 * This interface is the ONE shape sync components depend on, so production and the core-test
 * substrate are identical (no `lock?` branching at the call sites): `RwWorkspaceLock` is the real
 * async RW lock (production); `NoopWorkspaceLock` runs the body unlocked (core sync tests over bare
 * composites that exercise the algorithm, not the boundary discipline).
 */
export type WorkspaceLock = LoroWriteGuard & {
  /** Acquire a SHARED (read) lock, run `fn`, release. Any loro WRITE inside `fn` trips
   *  `assertWritable` — the backstop that keeps a read path honest. */
  read<T>(fn: () => T | Promise<T>): Promise<T>;
  /** Acquire an EXCLUSIVE (write) lock, run `fn`, release. `assertWritable` passes for the whole
   *  body (write authorized). */
  write<T>(fn: () => T | Promise<T>): Promise<T>;
};

/**
 * The production `WorkspaceLock`: an async read/write lock with WRITE-PRIORITY. A queued writer
 * blocks new readers, so an incoming sync import (or any writer) is not starved by a continuous read
 * stream. Readers that arrive while a writer is queued wait behind it; once the writer runs and
 * releases, all queued readers wake together.
 *
 * NON-REENTRANT by design (matches "acquire once at the boundary"). Acquiring `write` from inside a
 * `write`, or `read` from inside a `write` on the SAME flow, has no caller identity to detect, so it
 * would self-deadlock — a fail-loud signal that an operation is reaching across boundaries, not a
 * supported nesting. The operation model acquires exactly once per boundary.
 */
export class RwWorkspaceLock implements WorkspaceLock {
  private readers = 0;
  private writerActive = false;
  private readonly queuedWriters: (() => void)[] = [];
  private readonly queuedReaders: (() => void)[] = [];
  /** >0 iff an exclusive boundary is active on this flow. Exclusive is mutually exclusive, so this
   *  is 0 or 1 — a counter (not a boolean) only so a future re-entrant write could be detected. */
  private writeDepth = 0;

  async read<T>(fn: () => T | Promise<T>): Promise<T> {
    await this.acquireRead();
    try {
      return await fn();
    } finally {
      this.releaseRead();
    }
  }

  async write<T>(fn: () => T | Promise<T>): Promise<T> {
    await this.acquireWrite();
    this.writeDepth++;
    try {
      return await fn();
    } finally {
      this.writeDepth--;
      this.releaseWrite();
    }
  }

  assertWritable(): void {
    if (this.writeDepth <= 0) {
      throw new Error(
        "loro write inside a read-only (shared) boundary — acquire an exclusive lock to mutate",
      );
    }
  }

  private acquireRead(): Promise<void> {
    // A writer active OR a writer queued (write-priority) → wait. Otherwise admit immediately.
    if (!this.writerActive && this.queuedWriters.length === 0) {
      this.readers++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queuedReaders.push(resolve);
    });
  }

  private acquireWrite(): Promise<void> {
    if (!this.writerActive && this.readers === 0) {
      this.writerActive = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queuedWriters.push(resolve);
    });
  }

  private releaseRead(): void {
    this.readers--;
    this.dispatch();
  }

  private releaseWrite(): void {
    this.writerActive = false;
    this.dispatch();
  }

  /** Wake the next waiters after a release. Write-priority: if a writer is queued and no readers
   *  remain, it goes next; otherwise queued readers all wake (a just-released writer that left
   *  readers waiting behind a LATER queued writer still wakes those readers first, because the
   *  writer only blocks admission once it is queued — see acquireRead). */
  private dispatch(): void {
    if (this.writerActive) {
      return;
    }
    if (this.queuedWriters.length > 0) {
      if (this.readers === 0) {
        this.writerActive = true;
        this.queuedWriters.shift()!();
      }
      // Readers still active → the queued writer waits for them to drain; leave readers queued.
      return;
    }
    while (this.queuedReaders.length > 0) {
      this.readers++;
      this.queuedReaders.shift()!();
    }
  }
}

/**
 * A `WorkspaceLock` that does no locking: `read`/`write` run the body directly (a one-microtask delay
 * mirrors the real lock's async acquire) and `assertWritable` is a no-op. Inject this in CORE sync
 * tests over bare composites (no workspace, no boundary discipline) — those tests exercise the sync
 * algorithm, not the lock, so a real lock would be inert weight and a wrong shape to construct.
 */
export class NoopWorkspaceLock implements WorkspaceLock {
  read<T>(fn: () => T | Promise<T>): Promise<T> {
    return Promise.resolve().then(fn);
  }
  write<T>(fn: () => T | Promise<T>): Promise<T> {
    return Promise.resolve().then(fn);
  }
  assertWritable(): void {
    // No lock held in core tests — nothing to assert.
  }
}
