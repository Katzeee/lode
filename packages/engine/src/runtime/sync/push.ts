import { createLogger } from "@lode/logger";
import type { Component } from "../lifecycle.js";
import type { SyncContext } from "./context.js";

const log = createLogger("sync.push");

/** Trailing debounce for the push fast-path. `nodeUpdated` fires per payload (a createNode emits
 *  entityAdded + occurrenceAdded), so a burst would fire many pushes; this coalesces it into one
 *  push round. any-sync pushes inline on every mutation; lode MVP is CLI-coarse + low peer count, so
 *  a short trailing debounce bounds the push rate under a future typing surface. */
const PUSH_DEBOUNCE_MS = 150;

/**
 * The push fast-path: a trailing-debounced `pushOnly()` armed on every local mutation
 * (`engine.slots.nodeUpdated`). Registered AFTER the context in the per-workspace Lifecycle, so `start()`
 * runs after the context opened the transport — the "subscribe AFTER open()" invariant from the old
 * runner. The subscriber callback MUST stay synchronous + trivial: it runs inside the engine
 * Subject's `next`, whose error propagation would reach the mutation broadcast sub, so it may not
 * throw or await. The timer's `fire()` is async and catches its own errors (fire-and-forget); the
 * tick backstops any drop.
 */
export class PushFastPath implements Component {
  readonly name = "sync.push";
  private sub?: { unsubscribe(): void };
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(private readonly ctx: SyncContext) {}

  start(): void {
    this.sub = this.ctx.engine.slots.nodeUpdated.subscribe(() => this.schedule());
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
      void this.fire();
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

  stop(): void {
    this.stopped = true;
    this.sub?.unsubscribe();
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }
}
