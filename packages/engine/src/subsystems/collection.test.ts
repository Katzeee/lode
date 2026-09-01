import { describe, expect, it } from "vitest";
import { buildEngineSubsystems } from "./index.js";
import { defineEngineSubsystem } from "./definition.js";

describe("EngineSubsystemCollection", () => {
  it("constructs topologically and injects only declared capabilities", () => {
    const events: string[] = [];
    const storage = defineEngineSubsystem({
      id: "storage",
      dependencies: {},
      create: () => {
        events.push("construct:storage");
        return { capability: { read: () => "stored" } };
      },
    });
    const workspace = defineEngineSubsystem({
      id: "workspace",
      dependencies: { persistence: storage },
      create: (dependencies) => {
        events.push(`construct:workspace:${Object.keys(dependencies).join(",")}`);
        return { capability: { value: dependencies.persistence.read() } };
      },
    });

    const built = buildEngineSubsystems([workspace, storage], (capabilities) => ({
      storage: capabilities.storage.read(),
      workspace: capabilities.workspace.value,
    }));

    expect(built.api).toEqual({ storage: "stored", workspace: "stored" });
    expect(events).toEqual(["construct:storage", "construct:workspace:persistence"]);
  });

  it("rejects duplicate, unknown, and cyclic definitions before construction", () => {
    const first = emptyDefinition("same");
    const duplicate = emptyDefinition("same");
    expect(() => buildEngineSubsystems([first, duplicate], () => null)).toThrow("Duplicate Engine subsystem id");

    const absent = emptyDefinition("absent");
    const unknown = defineEngineSubsystem({
      id: "unknown",
      dependencies: { absent },
      create: () => ({ capability: null }),
    });
    expect(() => buildEngineSubsystems([unknown], () => null)).toThrow("unknown dependency 'absent'");

    const cyclicA = emptyDefinition("cyclic-a");
    const cyclicB = defineEngineSubsystem({
      id: "cyclic-b",
      dependencies: { cyclicA },
      create: () => ({ capability: null }),
    });
    Object.defineProperty(cyclicA, "dependencies", { value: { cyclicB } });
    expect(() => buildEngineSubsystems([cyclicA, cyclicB], () => null)).toThrow("cyclic-a -> cyclic-b -> cyclic-a");
  });

  it("finishes every init before dependency-ordered start and reverses stop", async () => {
    const events: string[] = [];
    const persistence = tracedDefinition("persistence", {}, events);
    const identity = tracedDefinition("identity", { persistence }, events);
    const workspace = tracedDefinition("workspace", { identity, persistence }, events);
    const { lifecycle } = buildEngineSubsystems([workspace, identity, persistence], () => null);

    await lifecycle.start();
    await lifecycle.stop();

    expect(events).toEqual([
      "init:persistence",
      "init:identity",
      "init:workspace",
      "start:persistence",
      "start:identity",
      "start:workspace",
      "stop:workspace:true",
      "stop:identity:true",
      "stop:persistence:true",
    ]);
  });

  it("rolls back every initialized member and reports every cleanup failure", async () => {
    const events: string[] = [];
    const ready = tracedDefinition("ready", {}, events, { stopError: "ready cleanup failed" });
    const broken = tracedDefinition("broken", { ready }, events, {
      initError: "init failed",
      stopError: "broken cleanup failed",
    });
    const { lifecycle } = buildEngineSubsystems([broken, ready], () => null);

    const failure = await lifecycle.start().catch((error: unknown) => error);

    expect(failure).toMatchObject({
      name: "EngineSubsystemLifecycleError",
      primary: { message: "init failed" },
      cleanupErrors: [{ message: "broken cleanup failed" }, { message: "ready cleanup failed" }],
    });
    expect(events).toEqual(["init:ready", "init:broken", "stop:broken:true", "stop:ready:true"]);
  });

  it("rolls back every initialized member when start fails", async () => {
    const events: string[] = [];
    const base = tracedDefinition("base", {}, events);
    const broken = tracedDefinition("broken", { base }, events, { startError: "start failed" });
    const later = tracedDefinition("later", { broken }, events);
    const { lifecycle } = buildEngineSubsystems([later, broken, base], () => null);

    await expect(lifecycle.start()).rejects.toMatchObject({ primary: { message: "start failed" } });
    expect(events).toEqual([
      "init:base",
      "init:broken",
      "init:later",
      "start:base",
      "start:broken",
      "stop:later:true",
      "stop:broken:true",
      "stop:base:true",
    ]);
  });

  it("closes the shared stop gate before cleanup begins", async () => {
    const events: string[] = [];
    const subsystem = defineEngineSubsystem({
      id: "gated",
      dependencies: {},
      create: (_dependencies, control) => ({
        capability: { accepting: () => !control.stopRequested },
        stop: () => {
          events.push(`stop:${control.stopRequested}`);
        },
      }),
    });
    const { lifecycle, api } = buildEngineSubsystems(
      [subsystem] as const,
      ({ gated }): Readonly<{ accepting(): boolean }> => gated,
    );
    await lifecycle.start();

    const stopping = lifecycle.stop();

    expect(api.accepting()).toBe(false);
    await stopping;
    expect(events).toEqual(["stop:true"]);
    await expect(lifecycle.start()).rejects.toMatchObject({ name: "EngineSubsystemCollectionStoppedError" });
  });

  it("attempts every cleanup and preserves the aggregate result", async () => {
    const events: string[] = [];
    let attempts = 0;
    const unrelated = tracedDefinition("unrelated", {}, events, { stopError: "unrelated cleanup failed" });
    const dependency = tracedDefinition("dependency", {}, events);
    const dependent = defineEngineSubsystem({
      id: "dependent",
      dependencies: { dependency },
      create: (_dependencies, control) => ({
        capability: null,
        stop: () => {
          attempts += 1;
          events.push(`stop:dependent:${control.stopRequested}`);
          throw new Error("dependent cleanup failed");
        },
      }),
    });
    const { lifecycle } = buildEngineSubsystems([unrelated, dependent, dependency], () => null);
    await lifecycle.start();

    const first = lifecycle.stop();
    const second = lifecycle.stop();

    expect(first).toBe(second);
    const failure = await first.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure).toMatchObject({
      errors: [{ message: "dependent cleanup failed" }, { message: "unrelated cleanup failed" }],
    });
    await expect(lifecycle.stop()).rejects.toBe(failure);
    expect(attempts).toBe(1);
    expect(events).toContain("stop:dependency:true");
    expect(events).toContain("stop:unrelated:true");
  });
});

function emptyDefinition<const Id extends string>(id: Id) {
  return defineEngineSubsystem({ id, dependencies: {}, create: () => ({ capability: null }) });
}

function tracedDefinition<
  const Id extends string,
  const Dependencies extends Readonly<Record<string, { readonly id: string }>>,
>(
  id: Id,
  dependencies: Dependencies,
  events: string[],
  failures: Readonly<{ initError?: string; startError?: string; stopError?: string }> = {},
) {
  return defineEngineSubsystem({
    id,
    dependencies,
    create: (_dependencies, control) => ({
      capability: { id },
      init: () => {
        events.push(`init:${id}`);
        if (failures.initError) {
          throw new Error(failures.initError);
        }
      },
      start: () => {
        events.push(`start:${id}`);
        if (failures.startError) {
          throw new Error(failures.startError);
        }
      },
      stop: () => {
        events.push(`stop:${id}:${control.stopRequested}`);
        if (failures.stopError) {
          throw new Error(failures.stopError);
        }
      },
    }),
  });
}
