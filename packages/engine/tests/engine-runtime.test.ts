import { create } from "@bufbuild/protobuf";
import { ListenNotificationsRequestSchema } from "@lode/protocol/proto";
import { describe, expect, it } from "vitest";
import { createEngineRuntime } from "../src/engine-runtime.js";

// The composition root registers every live-state holder on the Lifecycle so `app.stop()` reaches it.
// An in-memory runtime (no host connect component) still tears its notification streams down —
// reached here through the public `commands` surface, the same route every host takes.
describe("createEngineRuntime — app.stop() reaches every live-state holder", () => {
  it("completes the notification half's open streams on stop", async () => {
    const runtime = await createEngineRuntime();
    await runtime.lifecycle.start();
    const iter = runtime.commands
      .listenNotifications(create(ListenNotificationsRequestSchema, {}), "conn-1")
      [Symbol.asyncIterator]();

    await runtime.lifecycle.stop();
    await expect(iter.next()).resolves.toEqual({ value: undefined, done: true });
  });
});
