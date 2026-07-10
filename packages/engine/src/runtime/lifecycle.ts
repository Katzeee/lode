import { createLogger } from "@lode/logger";

// Lean composition root, mirroring any-sync's app.Component/app.App but adapted to TS: constructor
// injection (the caller builds a component with its deps, then registers it) rather than Go's
// service-locator lookup. A Component is a named subsystem with optional start/run/stop lifecycle.
// The Lifecycle starts components in registration order, runs their long-lived loops concurrently (each
// cancellable via an AbortSignal), and stops in reverse — centralizing lifecycle that would
// otherwise be hand-coded per subsystem.
//
// app.child() creates a sub-runtime whose `parent` is this Lifecycle. Each loaded workspace is such a
// ChildApp (see workspace/registry.ts): its components stop independently on unload, and it is the
// mounting point for per-workspace subsystems. Cross-level access (a child reaching a parent's
// component) is wired by passing the parent's already-constructed components into the child at
// build time — no runtime lookup needed.

const log = createLogger("app");

/** Mobile foreground/background seam. The desktop daemon stays `"active"`; a mobile host sets it
 *  to pause or back off background work (e.g. sync ticks). The Lifecycle stores + propagates the value to
 *  every component; there is no broadcaster in the MVP — a future host wires `setDeviceState`. */
export type DeviceState = "active" | "background" | "idle";

export type Component = {
  readonly name: string;
  /** One-shot setup (open a transport, subscribe). Reverse-stopped. A throw rolls back the
   *  already-started components and aborts the start. */
  start?(): void | Promise<void>;
  /** A long-running loop (tick, poll, stream). Receives an AbortSignal the Lifecycle aborts on stop(). A
   *  loop owns its OWN retry policy: a rejection is treated as that subsystem going down (logged),
   *  not a process-fatal — the rest of the app keeps running. */
  run?(signal: AbortSignal): void | Promise<void>;
  /** Reverse-stopped after all run-loops have drained. Best-effort: errors are logged, not thrown. */
  stop?(): void | Promise<void>;
  /** Notified when the device-state changes. */
  onDeviceState?(state: DeviceState): void;
};

export type LifecycleOptions = {
  /** How long stop() waits for in-flight run() loops to drain before warning + proceeding. Default
   *  5000ms. The abort signal already told the loops to stop; this bounds teardown against a hung
   *  loop (logged, not fatal). */
  readonly runSettleMs?: number;
};

const DEFAULT_RUN_SETTLE_MS = 5000;
const ACTIVE: DeviceState = "active";

export class Lifecycle {
  private readonly components: Component[] = [];
  private readonly runSettleMs: number;
  private started = false;
  private stopped = false;
  private deviceState: DeviceState = ACTIVE;
  private abort?: AbortController;
  private readonly runnings: Promise<unknown>[] = [];

  readonly parent?: Lifecycle;

  constructor(parent?: Lifecycle, options: LifecycleOptions = {}) {
    this.parent = parent;
    this.runSettleMs = options.runSettleMs ?? DEFAULT_RUN_SETTLE_MS;
  }

  // Constructor injection: register returns the same instance so the caller keeps a typed reference;
  // the Lifecycle owns only lifecycle ordering. Throws on a duplicate name — a programming error, not a
  // runtime condition (any-sync panics; lode throws).
  register<T extends Component>(component: T): T {
    if (this.components.some((c) => c.name === component.name)) {
      throw new Error(`component '${component.name}' already registered`);
    }
    this.components.push(component);
    return component;
  }

  child(options?: LifecycleOptions): Lifecycle {
    // Inherit the current device-state so a workspace opened while backgrounded starts in the
    // right state (mobile); the desktop daemon never changes it from "active".
    const child = new Lifecycle(this, options);
    child.deviceState = this.deviceState;
    return child;
  }

  /** Start every component (registration order), then run every long-lived loop concurrently. A
   *  start failure rolls back already-started components (reverse-stop). A synchronous run failure
   *  (before the loop begins) rolls back too; a later in-loop rejection is logged, not fatal. */
  async start(): Promise<void> {
    if (this.started || this.stopped) {
      return;
    }
    for (let i = 0; i < this.components.length; i++) {
      const c = this.components[i];
      if (c === undefined) {
        continue;
      }
      try {
        await c.start?.();
      } catch (err) {
        await this.reverseStop(i - 1);
        throw err;
      }
    }
    this.abort = new AbortController();
    for (let i = 0; i < this.components.length; i++) {
      const c = this.components[i];
      if (c === undefined || !c.run) {
        continue;
      }
      let p: Promise<unknown>;
      try {
        p = Promise.resolve(c.run(this.abort.signal));
      } catch (err) {
        // Synchronous throw from run() before it returned a promise — a startup failure.
        await this.shutdownFromStartupFailure(i);
        throw err;
      }
      this.runnings.push(p.catch((err) => this.onRunError(c, err)));
    }
    this.started = true;
  }

  /** Abort the run signal, await the loops' graceful drain (up to runSettleMs), then stop every
   *  component in reverse registration order. Idempotent. */
  async stop(): Promise<void> {
    if (!this.started || this.stopped) {
      return;
    }
    this.stopped = true;
    this.abort?.abort();
    await this.awaitRunnings();
    await this.reverseStop(this.components.length - 1);
    this.started = false;
  }

  /** True once stop() has run (the app is tearing down / torn down). A lifecycle-state query for
   *  tests + hosts that need to observe teardown — e.g. asserting a nested sub-graph stopped. */
  get isStopped(): boolean {
    return this.stopped;
  }

  setDeviceState(state: DeviceState): void {
    this.deviceState = state;
    for (const c of this.components) {
      c.onDeviceState?.(state);
    }
  }

  getDeviceState(): DeviceState {
    return this.deviceState;
  }

  /** A run loop rejected mid-life. The loop owns its retry policy; a rejection means that subsystem
   *  is down — log + leave the rest of the app running. */
  private onRunError(c: Component, err: unknown): void {
    log.warn("component run loop rejected", { name: c.name, err });
  }

  /** Reverse-stop components [0..n] (inclusive) — the rollback path on a start or run failure, and
   *  the whole-graph teardown in stop(). */
  private async reverseStop(n: number): Promise<void> {
    for (let i = n; i >= 0; i--) {
      const c = this.components[i];
      if (c === undefined) {
        continue;
      }
      try {
        await c.stop?.();
      } catch (err) {
        log.warn("component stop failed", { name: c.name, err });
      }
    }
  }

  /** A run() startup failure (index n started OK, then its run threw synchronously): abort the
   *  already-running loops, drain them, then reverse-stop [0..n]. */
  private async shutdownFromStartupFailure(n: number): Promise<void> {
    this.stopped = true;
    this.abort?.abort();
    await this.awaitRunnings();
    await this.reverseStop(n);
  }

  /** Await the tracked run promises, but no longer than runSettleMs. A hung loop is logged, not
   *  allowed to brick teardown — the abort already told it to drain. */
  private async awaitRunnings(): Promise<void> {
    if (this.runnings.length === 0) {
      return;
    }
    const settled = Promise.allSettled(this.runnings).then(() => true);
    const timedOut = new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), this.runSettleMs),
    );
    const drained = await Promise.race([settled, timedOut]);
    if (!drained) {
      log.warn("run loops did not drain within deadline; proceeding", {
        runSettleMs: this.runSettleMs,
      });
    }
  }
}

/** A Component that owns a child Lifecycle and stops it when its parent stops. Lets a long-lived Lifecycle (e.g.
 *  a workspace's ChildApp) host a disposable sub-graph that tears down WITH it — so one `app.stop()`
 *  from `removeWorkspace` collapses engine + store + sync into a single teardown, and the sub-graph
 *  can't outlive the workspace whose engine it reads. The child is built + started before this is
 *  registered, so a failed build discards the child (no holder left on the parent to conflict with a
 *  retry). */
export class ChildLifecycleComponent implements Component {
  constructor(
    readonly name: string,
    private readonly child: Lifecycle,
  ) {}
  async stop(): Promise<void> {
    await this.child.stop();
  }
}
