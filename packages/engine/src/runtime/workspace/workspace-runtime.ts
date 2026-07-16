import type { DocStore, Engine, Workspace } from "../../core/index.js";
import type { WorkspaceStore } from "../../persistence/workspace-store.js";
import type { Bus } from "../../events/bus.js";
import type { RuntimeInstance } from "../kernel/runtime.js";
import type { MembershipLog } from "../membership/membership-log.js";
import type { WorkspaceLock } from "./loro-lock.js";

/**
 * One loaded workspace and the lifetime that protects all of its handles. Callers can use the
 * engine only inside run/runExclusive; shutdown closes admission before it waits for those leases.
 *
 * `lock` is the per-workspace read/write lock over ALL of this workspace's loro docs (tree + shards
 * + membership + meta). `run` acquires it SHARED (a read sees a consistent snapshot; many reads at
 * once); `runExclusive` acquires it EXCLUSIVE (one writer, atomic). The lock is exposed so the sync
 * sub-graph — which does not run through this runtime — can acquire the SAME lock at each of its loro
 * stages, closing the read/write-vs-sync-import re-entrancy gap.
 */
export class WorkspaceRuntime {
  constructor(
    readonly id: string,
    readonly instance: RuntimeInstance,
    readonly workspace: Workspace,
    readonly store: WorkspaceStore | null,
    readonly docStore: DocStore,
    readonly membership: MembershipLog,
    readonly facts: Bus,
    /** The per-workspace loro read/write lock. Boundary locking: `run`/`runExclusive` acquire it
     *  here; sync acquires it at each loro stage. The primitives themselves never self-lock. */
    readonly lock: WorkspaceLock,
  ) {}

  get engine(): Engine {
    const engine = this.workspace.engine;
    if (engine === null) {
      throw new Error(`workspace ${this.id} has no engine`);
    }
    return engine;
  }

  run<T>(operation: (runtime: WorkspaceRuntime) => T | Promise<T>): Promise<T> {
    return this.instance.run("workspace-read", () =>
      // SHARED lock: concurrent reads see a consistent snapshot (no writer slips in mid-read); any
      // loro write inside `operation` trips the lock's write guard.
      this.lock.read(() => operation(this)),
    );
  }

  runExclusive<T>(operation: (runtime: WorkspaceRuntime) => T | Promise<T>): Promise<T> {
    return this.instance.run("workspace-exclusive", (forcedAbort) =>
      // EXCLUSIVE lock: one writer at a time, atomic across the whole body (including local shard
      // faults). The per-workspace exclusive lock IS the write serialization — there is no separate
      // operation chain. `forcedAbort` is the instance's drain-timeout signal (a stop() that cannot
      // wait for this lease forces it).
      this.lock.write(() => {
        if (forcedAbort.aborted) {
          throw forcedAbort.reason instanceof Error
            ? forcedAbort.reason
            : new Error(`workspace ${this.id} operation aborted`);
        }
        return operation(this);
      }),
    );
  }

  flush(): Promise<void> {
    return this.engine.asOutliner().flushDirty();
  }
}
