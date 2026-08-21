import type { EngineEvent } from "@lode/sdk";
import { describe, expect, it, vi } from "vitest";

import { buildEngineSubsystems } from "../index.js";
import { createEventSubsystemDefinition } from "./event-subsystem.js";

describe("EventSubsystem", () => {
  it("owns subscriptions only while active and isolates listener failures", async () => {
    const event = createEvent();
    const built = buildEvent();
    const listener = vi.fn();

    expect(() => built.api.subscribe(listener)).toThrow("Event subsystem is not active");
    built.api.publish(event);
    await built.lifecycle.start();
    built.api.subscribe(() => {
      throw new Error("listener failed");
    });
    built.api.subscribe(listener);

    built.api.publish(event);
    expect(listener).toHaveBeenCalledWith(event);

    await built.lifecycle.stop();
    built.api.publish(event);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(() => built.api.subscribe(listener)).toThrow("Event subsystem is not active");
  });

  it("rejects events whose publisher has not made them immutable", async () => {
    const built = buildEvent();
    await built.lifecycle.start();
    expect(() => built.api.publish({ ...createEvent(), frontier: {} })).toThrow(
      "Event publishers must provide immutable events",
    );
    await built.lifecycle.stop();
  });
});

function buildEvent() {
  const event = createEventSubsystemDefinition();
  return buildEngineSubsystems([event] as const, ({ event: capability }) => capability);
}

function createEvent(): EngineEvent {
  const frontier = Object.freeze({});
  return Object.freeze({
    kind: "projection-published",
    workspaceId: "workspace-1",
    frontier,
    generationId: "generation-1",
  });
}
