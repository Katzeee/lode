import type { DocStore, Engine, Workspace } from "../../core/index.js";
import type { WorkspaceStore } from "../../persistence/workspace-store.js";
import type { Bus } from "../../events/bus.js";
import type { RuntimeInstance } from "../kernel/runtime.js";
import type { MembershipLog } from "../membership/membership-log.js";

/**
 * One loaded workspace and the lifetime that protects all of its handles. Callers can use the
 * engine only inside run/runExclusive; shutdown closes admission before it waits for those leases.
 */
export class WorkspaceRuntime {
  private operationChain: Promise<void> = Promise.resolve();

  constructor(
    readonly id: string,
    readonly instance: RuntimeInstance,
    readonly workspace: Workspace,
    readonly store: WorkspaceStore | null,
    readonly docStore: DocStore,
    readonly membership: MembershipLog,
    readonly facts: Bus,
  ) {}

  get engine(): Engine {
    const engine = this.workspace.engine;
    if (engine === null) {
      throw new Error(`workspace ${this.id} has no engine`);
    }
    return engine;
  }

  run<T>(operation: (runtime: WorkspaceRuntime) => T | Promise<T>): Promise<T> {
    return this.instance.run("workspace-read", async () => operation(this));
  }

  runExclusive<T>(operation: (runtime: WorkspaceRuntime) => T | Promise<T>): Promise<T> {
    return this.instance.run("workspace-exclusive", async (forcedAbort) => {
      const previous = this.operationChain;
      let release!: () => void;
      this.operationChain = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        if (forcedAbort.aborted) {
          throw forcedAbort.reason instanceof Error
            ? forcedAbort.reason
            : new Error(`workspace ${this.id} operation aborted`);
        }
        return await operation(this);
      } finally {
        release();
      }
    });
  }

  flush(): Promise<void> {
    return this.engine.asOutliner().flushDirty();
  }
}
