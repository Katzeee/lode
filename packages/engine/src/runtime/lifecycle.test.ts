import { describe, expect, it } from "vitest";
import { Lifecycle, type Component, type DeviceState } from "./lifecycle.js";

// A start/stop recorder: pushes its lifecycle events into `log` so a test can assert ordering.
function trace(name: string, log: string[]): Component {
  return {
    name,
    start: () => {
      log.push(`start:${name}`);
    },
    stop: () => {
      log.push(`stop:${name}`);
    },
  };
}

describe("Lifecycle", () => {
  it("starts components in registration order and stops them in reverse", async () => {
    const log: string[] = [];
    const app = new Lifecycle();
    app.register(trace("a", log));
    app.register(trace("b", log));
    app.register(trace("c", log));
    await app.start();
    await app.stop();
    expect(log).toEqual(["start:a", "start:b", "start:c", "stop:c", "stop:b", "stop:a"]);
  });

  it("start and stop are idempotent", async () => {
    const log: string[] = [];
    const app = new Lifecycle();
    app.register(trace("a", log));
    await app.start();
    await app.start(); // no-op
    await app.stop();
    await app.stop(); // no-op
    expect(log).toEqual(["start:a", "stop:a"]);
  });

  it("rolls back already-started components when a later start throws", async () => {
    const stopped: string[] = [];
    const app = new Lifecycle();
    app.register({
      name: "a",
      start() {},
      stop() {
        stopped.push("a");
      },
    });
    app.register({
      name: "b",
      start() {},
      stop() {
        stopped.push("b");
      },
    });
    app.register({
      name: "c",
      start() {
        throw new Error("boom");
      },
    });
    await expect(app.start()).rejects.toThrow("boom");
    // c failed mid-start (index 2): reverse-stop [0..1] → b then a. c itself is not stopped.
    expect(stopped).toEqual(["b", "a"]);
    // The app is left not-started (start never completed): a subsequent stop() is a no-op —
    // a/b are not double-stopped.
    await app.stop();
    expect(stopped).toEqual(["b", "a"]);
  });

  it("rolls back when a run() throws synchronously before its first await", async () => {
    const stopped: string[] = [];
    const app = new Lifecycle();
    app.register({
      name: "a",
      start() {},
      run() {},
      stop() {
        stopped.push("a");
      },
    });
    app.register({
      name: "b",
      start() {},
      run() {
        throw new Error("boom");
      },
      stop() {
        stopped.push("b");
      },
    });
    await expect(app.start()).rejects.toThrow("boom");
    // a.run already launched (settled); b.run threw synchronously → reverse-stop [0..1] → b, a.
    expect(stopped).toEqual(["b", "a"]);
  });
});

describe("Lifecycle run loops", () => {
  it("hands each run an AbortSignal that is aborted on stop, and awaits graceful drain", async () => {
    let aborted = false;
    let resolveRun!: () => void;
    const app = new Lifecycle();
    app.register({
      name: "loop",
      start() {},
      run(signal) {
        signal.addEventListener("abort", () => {
          aborted = true;
          resolveRun();
        });
        return new Promise<void>((resolve) => {
          resolveRun = resolve;
        });
      },
    });
    await app.start();
    expect(aborted).toBe(false);
    await app.stop();
    expect(aborted).toBe(true);
  });

  it("does not hang on stop if a run loop ignores the abort — bounded by runSettleMs", async () => {
    const stopped: string[] = [];
    const app = new Lifecycle(undefined, { runSettleMs: 30 });
    app.register({
      name: "hung",
      start() {},
      run: () => new Promise<void>(() => {}),
      stop() {
        stopped.push("hung");
      },
    });
    const before = Date.now();
    await app.start();
    await app.stop();
    expect(Date.now() - before).toBeLessThan(2000); // bounded by the deadline, not forever
    expect(stopped).toEqual(["hung"]); // reverse-stop still ran after the deadline
  });

  it("logs and continues when a run loop rejects mid-life (does not tear down siblings)", async () => {
    const stopped: string[] = [];
    const app = new Lifecycle(undefined, { runSettleMs: 30 });
    app.register({
      name: "good",
      start() {},
      run: () => new Promise<void>(() => {}), // stays up
      stop() {
        stopped.push("good");
      },
    });
    app.register({
      name: "bad",
      start() {},
      run: () => Promise.reject(new Error("mid-life boom")),
    });
    await app.start();
    await app.stop();
    // The bad loop's rejection was swallowed (logged); the good sibling + reverse-stop still ran.
    expect(stopped).toEqual(["good"]);
  });
});

describe("Lifecycle registration + device state", () => {
  it("throws on a duplicate component name", () => {
    const app = new Lifecycle();
    app.register({ name: "x" });
    expect(() => app.register({ name: "x" })).toThrow(/already registered/);
  });

  it("propagates device-state to every component's onDeviceState", () => {
    const seen: DeviceState[] = [];
    const app = new Lifecycle();
    app.register({ name: "a", onDeviceState: (s) => seen.push(s) });
    app.setDeviceState("background");
    app.setDeviceState("idle");
    expect(seen).toEqual(["background", "idle"]);
    expect(app.getDeviceState()).toBe("idle");
  });

  it("a child inherits the parent's current device-state", () => {
    const app = new Lifecycle();
    app.setDeviceState("background");
    const child = app.child();
    expect(child.getDeviceState()).toBe("background");
    expect(child.parent).toBe(app);
  });
});
