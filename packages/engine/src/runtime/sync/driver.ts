import { createLogger } from "@lode/logger";
import type { RuntimeInstance } from "../kernel/runtime.js";
import type { RuntimeResource } from "../kernel/resource.js";
import type { SyncContext } from "./context.js";
import { syncMembershipDoc } from "./membership-sync.js";

const log = createLogger("sync.driver");

/** Round-summary shape the engine emits each content round; the host decides the UX. */
export type RoundSummary = { readonly pulled: number; readonly pushed: number };

export type SyncRoundDriverOptions = {
  /** Round interval; default 20000ms (20s — the reconciliation backstop, anytype-aligned). */
  readonly intervalMs: number;
  readonly ctx: SyncContext;
  readonly report: (wsId: string, summary: RoundSummary) => void;
};

/**
 * Drives one round every `intervalMs` for a single workspace: membership round then content round
 * (in that order, so the content round's `isMember()` gate re-derives on the just-moved membership
 * frontier), with a `busy` guard that skips overlapping rounds. `busy` is PER-WORKSPACE here — the
 * old `DaemonSyncRunner` carried one global `busy` across all workspaces, so a slow round on one
 * blocked the next; that coupling is gone (a behavior improvement, called out in the design doc).
 *
 * `run(signal)` wraps the existing `setInterval` shape with abort-driven cleanup: the interval fires
 * every `intervalMs` exactly as before, and the loop resolves when its owning instance quiesces on
 * stop(). The loop never rejects — per-round errors are caught + logged (a round may fail
 * transiently: a relay blip, a peer mid-restart); the next round retries, so aborting the driver
 * would be wrong.
 *
 * `roundNow()` exposes one synchronous round for the host's foreground trigger (`syncNow`).
 */
export class SyncRoundDriver implements RuntimeResource {
  readonly id = "sync.driver";
  private readonly intervalMs: number;
  private readonly ctx: SyncContext;
  private readonly report: (wsId: string, summary: RoundSummary) => void;
  private busy = false;
  private instance?: RuntimeInstance;

  constructor(opts: SyncRoundDriverOptions) {
    this.intervalMs = opts.intervalMs;
    this.ctx = opts.ctx;
    this.report = opts.report;
  }

  start(instance: RuntimeInstance): void {
    this.instance = instance;
    instance.spawn(
      "round-scheduler",
      (quiescing) =>
        new Promise<void>((resolve) => {
          const timer = setInterval(() => {
            if (!quiescing.aborted) {
              void this.roundNow();
            }
          }, this.intervalMs);
          quiescing.addEventListener(
            "abort",
            () => {
              clearInterval(timer);
              resolve();
            },
            { once: true },
          );
        }),
    );
  }

  /** One round now instead of waiting for the next tick — the host's `syncNow`. Same `busy` overlap
   *  guard as the tick: if a round is already running this is a no-op (that round covers it).
   *  Transient round failures are swallowed exactly as in the tick; a stop() mid-round is expected
   *  teardown (debug), not a fault. */
  async roundNow(): Promise<void> {
    const instance = this.instance;
    if (instance === undefined || instance.state !== "active") {
      return;
    }
    await instance.run("sync-round", () => this.executeRound());
  }

  private async executeRound(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    try {
      // Membership half: gossip the roster + persist dirtied log state. Wire security is a lazy
      // projection of the log (re-derives on read when the frontier moves), so the content round's
      // isMember() gate picks up the new roster automatically — no security refresh here.
      await syncMembershipDoc(this.ctx.transport, this.ctx.log.metaDoc, this.ctx.lock);
      // persistIfDirty reads frontiers + exports a snapshot (loro reads) before its disk write →
      // SHARED; the disk write is local/bounded and stays under the shared boundary.
      await this.ctx.lock.read(() => this.ctx.log.persistIfDirty());
      // Content half: only once the local actor is a member (before the membership log converges it
      // isn't, so content is skipped, not errored — the membership half is what lets it join). Flush
      // what the round delivered (tree edits + imported shards) so a pure receiver that crashes after
      // a round keeps it on restart: tree always, plus any resident shard not already write-backed.
      // flushDirty exports updates (loro reads) + disk writes → SHARED.
      if (this.ctx.security.isMember()) {
        const { pulled, pushed } = await this.ctx.syncManager.sync();
        await this.ctx.lock.read(() => this.ctx.engine.asOutliner().flushDirty());
        this.report(this.ctx.wsId, { pulled, pushed });
      }
    } catch (err) {
      // `stopped` = stop()'s transport close mid-round (expected teardown → debug); a real relay
      // drop / peer mid-restart → warn. Never abort the driver — the next round retries.
      if (this.instance?.quiescing.aborted) {
        log.debug("sync round aborted on stop", { wsId: this.ctx.wsId, err });
      } else {
        log.warn("sync round failed", { wsId: this.ctx.wsId, err });
      }
    } finally {
      this.busy = false;
    }
  }
}
