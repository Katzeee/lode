import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { SessionHelloRequestSchema } from "@lode/protocol/proto";
import { generateActorKeypair } from "../utils/crypto/index.js";
import { createAppRuntime } from "./app-runtime.js";

// The composition root registers every live-state holder on the App so `app.stop()` reaches it.
// Phase 1 rooted the SessionManager (notification streams + session/subscriber maps) — these cover
// that contract: an in-memory runtime (no host connect component) still tears its streams down.
describe("createAppRuntime — app.stop() reaches every live-state holder", () => {
  it("completes the SessionManager's open notification streams on stop", async () => {
    const runtime = await createAppRuntime();
    await runtime.app.start();

    runtime.sessions.createSession(
      "conn-1",
      create(SessionHelloRequestSchema, { mnemonic: "x" }),
      generateActorKeypair(),
    );
    const iter = runtime.sessions.getOrCreateStream("conn-1")[Symbol.asyncIterator]();

    await runtime.app.stop();
    await expect(iter.next()).resolves.toEqual({ value: undefined, done: true });
  });
});
