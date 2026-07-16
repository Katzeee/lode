import type { RuntimeInstance } from "../kernel/runtime.js";
import type { LocalPeer } from "../membership/membership-log.js";
import type { WorkspaceRuntime } from "../workspace/workspace-runtime.js";
import { SyncContext } from "./context.js";
import type { RoundSummary } from "./driver.js";
import { SyncRoundDriver } from "./driver.js";
import { PushFastPath } from "./push.js";
import type { SyncTransportFactory } from "./transport.js";

export type WorkspaceSyncSessionOptions = {
  readonly workspace: WorkspaceRuntime;
  readonly relayUrl: string;
  readonly localPeer: LocalPeer;
  readonly transportFactory: SyncTransportFactory;
  readonly roundIntervalMs: number;
  readonly report: (workspaceId: string, summary: RoundSummary) => void;
  readonly onClosed: (session: WorkspaceSyncSession) => void;
};

/** The complete sync lifetime for one loaded workspace. */
export class WorkspaceSyncSession {
  private constructor(
    readonly workspace: WorkspaceRuntime,
    readonly instance: RuntimeInstance,
    readonly context: SyncContext,
    readonly driver: SyncRoundDriver,
  ) {}

  static async open(options: WorkspaceSyncSessionOptions): Promise<WorkspaceSyncSession> {
    const { workspace } = options;
    const mounted = await workspace.instance.mount("sync-session", (instance) => {
      const context = new SyncContext({
        wsId: workspace.id,
        url: options.relayUrl,
        log: workspace.membership,
        local: options.localPeer,
        engine: workspace.engine,
        facts: workspace.facts,
        transportFactory: options.transportFactory,
        lock: workspace.lock,
      });
      const driver = new SyncRoundDriver({
        intervalMs: options.roundIntervalMs,
        ctx: context,
        report: options.report,
      });
      instance.own(context);
      instance.own(driver);
      instance.own(new PushFastPath(context));
      return new WorkspaceSyncSession(workspace, instance, context, driver);
    });
    const session = mounted.api;
    mounted.instance.onStopped(() => options.onClosed(session));
    return session;
  }

  roundNow(): Promise<void> {
    return this.driver.roundNow();
  }
}
