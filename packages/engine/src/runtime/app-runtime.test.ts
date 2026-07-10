import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { SessionHelloRequestSchema } from "@lode/protocol/proto";
import { generateActorKeypair } from "../utils/crypto/index.js";
import { createAppRuntime } from "./app-runtime.js";

// The composition root registers every live-state holder on the App so `app.stop()` reaches it.
// Phase 1 rooted the session/notification state (now split: NotificationManager streams + SessionIdentity bookkeeping) — these cover
// that contract: an in-memory runtime (no host connect component) still tears its streams down.
describe("createAppRuntime — app.stop() reaches every live-state holder", () => {
  it("completes the notification half's open streams on stop", async () => {
    const runtime = await createAppRuntime();
    await runtime.app.start();

    runtime.identity.createSession(
      "conn-1",
      create(SessionHelloRequestSchema, { mnemonic: "x" }),
      generateActorKeypair(),
    );
    const iter = runtime.notify.getOrCreateStream("conn-1")[Symbol.asyncIterator]();

    await runtime.app.stop();
    await expect(iter.next()).resolves.toEqual({ value: undefined, done: true });
  });
});
