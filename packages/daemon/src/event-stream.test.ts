import { describe, expect, it, vi } from "vitest";

import type { EngineEvent } from "@lode/sdk";
import { eventStream } from "./event-stream.js";

describe("daemon event stream buffering", () => {
  it("terminates and unsubscribes when a subscriber cannot keep up", async () => {
    const event = projectionPublished();
    const unsubscribe = vi.fn();
    const stream = eventStream((listener) => {
      for (let index = 0; index < 257; index += 1) {
        listener(event);
      }
      return unsubscribe;
    }, new AbortController().signal);

    expect(unsubscribe).toHaveBeenCalledOnce();
    const iterator = stream[Symbol.asyncIterator]();
    for (let index = 0; index < 256; index += 1) {
      await expect(iterator.next()).resolves.toMatchObject({ done: false });
    }
    await expect(iterator.next()).rejects.toThrow("exceeded its 256-event buffer");
  });
});

function projectionPublished(): EngineEvent {
  return {
    kind: "projection-published",
    workspaceId: "workspace",
    frontier: {},
    generationId: "generation",
  };
}
