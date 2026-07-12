import { createLogger } from "@lode/logger";
import type { RuntimeInstance } from "../kernel/runtime.js";
import type { RuntimeResource } from "../kernel/resource.js";
import type { StopReason } from "../kernel/types.js";
import type { SyncContext } from "./context.js";
import type { Subscription } from "../../events/bus.js";
import { Committed } from "../workspace/workspace-facts.js";

const log = createLogger("sync.push");

/** Trailing debounce for the push fast-path. A committed fact carries every effect of a mutation
 *  (a createNode emits entityAdded + occurrenceAdded), so a burst would fire many pushes; this
 *  coalesces it into one push round. any-sync pushes inline on every mutation; lode MVP is CLI-coarse
 *  + low peer count, so a short trailing debounce bounds the push rate under a future typing surface. */
const PUSH_DEBOUNCE_MS = 150;

/**
 * The push fast-path: a trailing-debounced `pushOnly()` armed on every local mutation
 * (the workspace event topic). Owned after the context in the sync-session instance, so `start()`
 * runs after the context opened the transport — the "subscribe AFTER open()" invariant from the old
 * runner. The subscriber callback MUST stay synchronous + trivial: it runs inside the workspace
 * event topic's synchronous `publish`, whose error propagation would reach the broadcast, so it may
 * not throw or await. The timer's `fire()` is async and catches its own errors (fire-and-forget);
 * the tick backstops any drop.
 */
export class PushFastPath implements RuntimeResource {
  readonly id = "sync.push";
  private subscription: Subscription | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private instance?: RuntimeInstance;

  constructor(private readonly ctx: SyncContext) {}

  start(instance: RuntimeInstance): void {
    this.instance = instance;
    this.subscription = this.ctx.facts.on(Committed, () => this.schedule());
  }

  private schedule(): void {
    if (this.stopped) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const instance = this.instance;
      if (instance?.state === "active") {
        void instance.run("sync-push", () => this.fire());
      }
    }, PUSH_DEBOUNCE_MS);
  }

  private async fire(): Promise<void> {
    if (this.stopped) {
      return;
    }
    // Send-only push — no `busy` guard (must not serialize behind a slow tick). The cached
    // lastRemoteVV makes a stale-profile push redundant-bandwidth-only (Loro import is idempotent).
    try {
      await this.ctx.syncManager.pushOnly();
    } catch (err) {
      log.warn("sync push failed", { wsId: this.ctx.wsId, err });
    }
  }

  quiesce(_reason: StopReason): void {
    this.stopped = true;
    this.subscription?.unsubscribe();
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }

  release(): void {
    this.quiesce({ kind: "requested" });
  }
}
