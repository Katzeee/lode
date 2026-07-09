import { createLogger } from "@lode/logger";
import type { Component } from "../app.js";
import type { MembershipRound, ContentRound } from "./round.js";

const log = createLogger("sync.driver");

export type SyncRoundDriverOptions = {
  readonly wsId: string;
  /** Round interval; default 20000ms (20s — the reconciliation backstop, anytype-aligned). */
  readonly intervalMs: number;
  readonly membership: MembershipRound;
  readonly content: ContentRound;
};

/**
 * Drives one round every `intervalMs` for a single workspace: membership round then content round
 * (in that order, so the content round's `isMember()` gate re-derives on the just-moved membership
 * frontier), with a `busy` guard that skips overlapping rounds. `busy` is PER-WORKSPACE here — the
 * old `DaemonSyncRunner` carried one global `busy` across all workspaces, so a slow round on one
 * blocked the next; that coupling is gone (a behavior improvement, called out in the design doc).
 *
 * `run(signal)` wraps the existing `setInterval` shape with abort-driven cleanup: the interval fires
 * every `intervalMs` exactly as before, and the loop resolves when the App aborts the signal on
 * stop(). The loop never rejects — per-round errors are caught + logged (a round may fail
 * transiently: a relay blip, a peer mid-restart); the next round retries, so aborting the driver
 * would be wrong.
 *
 * `roundNow()` exposes one synchronous round for the host's foreground trigger (`syncNow`).
 */
export class SyncRoundDriver implements Component {
  readonly name = "sync.driver";
  private readonly wsId: string;
  private readonly intervalMs: number;
  private readonly membership: MembershipRound;
  private readonly content: ContentRound;
  private busy = false;
  private signal?: AbortSignal;

  constructor(opts: SyncRoundDriverOptions) {
    this.wsId = opts.wsId;
    this.intervalMs = opts.intervalMs;
    this.membership = opts.membership;
    this.content = opts.content;
  }

  async run(signal: AbortSignal): Promise<void> {
    this.signal = signal;
    return new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        void this.roundNow();
      }, this.intervalMs);
      signal.addEventListener(
        "abort",
        () => {
          clearInterval(timer);
          resolve();
        },
        { once: true },
      );
    });
  }

  /** One round now instead of waiting for the next tick — the host's `syncNow`. Same `busy` overlap
   *  guard as the tick: if a round is already running this is a no-op (that round covers it).
   *  Transient round failures are swallowed exactly as in the tick; a stop() mid-round is expected
   *  teardown (debug), not a fault. */
  async roundNow(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    try {
      await this.membership.runRound();
      await this.content.runRound();
    } catch (err) {
      // `stopped` = stop()'s transport close mid-round (expected teardown → debug); a real relay
      // drop / peer mid-restart → warn. Never abort the driver — the next round retries.
      if (this.signal?.aborted) {
        log.debug("sync round aborted on stop", { wsId: this.wsId, err });
      } else {
        log.warn("sync round failed", { wsId: this.wsId, err });
      }
    } finally {
      this.busy = false;
    }
  }
}
