import { describe, expect, it } from "vitest";
import { AppRuntime } from "./app-runtime.js";
import type { RuntimeResource } from "./resource.js";
import { InstanceUnavailableError } from "./types.js";

function traced(id: string, events: string[]): RuntimeResource {
  return {
    id,
    start: () => {
      events.push(`start:${id}`);
    },
    quiesce: () => {
      events.push(`quiesce:${id}`);
    },
    checkpoint: () => {
      events.push(`checkpoint:${id}`);
    },
    release: () => {
      events.push(`release:${id}`);
    },
  };
}

describe("AppRuntime", () => {
  it("starts owned members in declaration order and stops them in reverse", async () => {
    const events: string[] = [];
    const runtime = new AppRuntime("test");
    const a = await runtime.root.mount("a", (instance) => {
      instance.own(traced("a-resource", events));
      return "a";
    });
    runtime.root.own(traced("host", events));

    await runtime.start();
    const report = await runtime.stop();

    expect(a.api).toBe("a");
    expect(report.graceful).toBe(true);
    expect(events).toEqual([
      "start:a-resource",
      "start:host",
      "quiesce:host",
      "quiesce:a-resource",
      "checkpoint:a-resource",
      "checkpoint:host",
      "release:host",
      "release:a-resource",
    ]);
  });

  it("atomically rolls back every acquired resource when construction fails", async () => {
    const events: string[] = [];
    const runtime = new AppRuntime("test");

    await expect(
      runtime.root.mount("broken", (instance) => {
        instance.own(traced("opened-handle", events));
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(events).toEqual(["release:opened-handle"]);
    await expect(runtime.root.mount("broken", () => "retry")).resolves.toMatchObject({
      api: "retry",
    });
  });

  it("releases every acquired resource when startup fails", async () => {
    const released: string[] = [];
    const runtime = new AppRuntime("test");
    runtime.root.own({ id: "ready", release: () => void released.push("ready") });
    runtime.root.own({
      id: "broken",
      start: () => {
        throw new Error("start failed");
      },
      release: () => void released.push("broken"),
    });

    await expect(runtime.start()).rejects.toThrow("start failed");
    expect(released).toEqual(["broken", "ready"]);
    expect(runtime.root.isStopped).toBe(true);
  });

  it("stopping a child detaches it from its owner without a second teardown path", async () => {
    let releases = 0;
    const runtime = new AppRuntime("test");
    const child = await runtime.root.mount("child", (instance) => {
      instance.own({
        id: "resource",
        release: () => {
          releases++;
        },
      });
      return undefined;
    });
    await runtime.start();

    await child.instance.stop();
    await runtime.stop();

    expect(releases).toBe(1);
  });

  it("closes admission before draining accepted work", async () => {
    let release!: () => void;
    const runtime = new AppRuntime("test");
    await runtime.start();
    const running = runtime.root.run(
      "operation",
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    await Promise.resolve();
    const stopping = runtime.stop();
    await Promise.resolve();

    expect(() => runtime.root.run("late", async () => {})).toThrow(InstanceUnavailableError);
    release();
    await running;
    await expect(stopping).resolves.toMatchObject({ graceful: true });
  });

  it("reports work that ignores graceful and forced cancellation", async () => {
    const runtime = new AppRuntime("test", { drainTimeoutMs: 5, abortTimeoutMs: 5 });
    await runtime.start();
    runtime.root.spawn("hung", async () => new Promise<void>(() => {}));

    await expect(runtime.stop()).resolves.toMatchObject({
      graceful: false,
      dirty: true,
      abandonedOperations: ["test:hung"],
    });
  });

  it("propagates device state and notifies child stop exactly once", async () => {
    const states: string[] = [];
    let stopped = 0;
    const runtime = new AppRuntime("test");
    const child = await runtime.root.mount("child", (instance) => {
      instance.own({ id: "state", onDeviceState: (state) => states.push(state) });
      return undefined;
    });
    child.instance.onStopped(() => stopped++);
    await runtime.start();

    runtime.root.setDeviceState("background");
    await Promise.all([child.instance.stop(), child.instance.stop()]);
    await runtime.stop();

    expect(states).toEqual(["background"]);
    expect(stopped).toBe(1);
  });
});
