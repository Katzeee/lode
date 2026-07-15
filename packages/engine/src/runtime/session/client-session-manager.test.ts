import { create } from "@bufbuild/protobuf";
import { SessionHelloRequestSchema } from "@lode/protocol/proto";
import { describe, expect, it } from "vitest";
import { generateActorKeypair } from "../../crypto/index.js";
import { Bus } from "../../events/bus.js";
import { Committed } from "../workspace/workspace-facts.js";
import { AppRuntime } from "../kernel/app-runtime.js";
import { ClientSessionManager, SessionRequiredError } from "./client-session-manager.js";
import { VaultRuntime } from "../identity/vault.js";

const origin = { nodeId: "node-1", actorId: "actor-1", sessionId: "session-1" };

async function authenticate(manager: ClientSessionManager, connectionId: string): Promise<void> {
  await manager.createSession(
    connectionId,
    create(SessionHelloRequestSchema, {}),
    generateActorKeypair(),
  );
}

describe("ClientSessionManager", () => {
  it("owns the authentication gate and connection teardown", async () => {
    const app = new AppRuntime("test");
    const mounted = await app.root.mount(
      "sessions",
      (instance) => new ClientSessionManager(instance, "node-1"),
    );
    await app.start();
    const sessions = mounted.api;
    expect(() => sessions.resolveCaller("connection")).toThrow(SessionRequiredError);
    await authenticate(sessions, "connection");
    expect(sessions.resolveCaller("connection").origin.nodeId).toBe("node-1");

    const stream = sessions.listenNotifications("connection")[Symbol.asyncIterator]();
    await sessions.removeConnection("connection");
    await expect(stream.next()).resolves.toEqual({ value: undefined, done: true });
    expect(() => sessions.resolveCaller("connection")).toThrow(SessionRequiredError);
  });

  it("projects Committed facts and detaches when the workspace instance stops", async () => {
    const app = new AppRuntime("test");
    const sessions = new ClientSessionManager(app.root, "node-1");
    const facts = new Bus();
    const workspace = await app.root.mount("workspace", () => undefined);
    await app.start();
    await authenticate(sessions, "connection");
    const stream = sessions.listenNotifications("connection")[Symbol.asyncIterator]();
    await sessions.subscribeWorkspace("connection", "workspace", workspace.instance, facts);

    facts.emit(new Committed("workspace", origin, [{ type: "entityDeleted", nodeId: "node" }]));
    const delivered = await stream.next();
    expect(delivered.done).toBe(false);
    if (delivered.done) {
      throw new Error("expected a notification");
    }
    expect(delivered.value.workspaceId).toBe("workspace");
    expect(delivered.value.payloads).toHaveLength(1);

    await workspace.instance.stop();
    sessions.unsubscribeWorkspace("connection", "workspace");
    sessions.release();
    await app.stop();
  });

  it("fails a slow notification stream at its bound instead of growing without limit", async () => {
    const app = new AppRuntime("test");
    const sessions = new ClientSessionManager(app.root, "node-1", VaultRuntime.disabled(), 1);
    const facts = new Bus();
    const workspace = await app.root.mount("workspace", () => undefined);
    await app.start();
    await authenticate(sessions, "connection");
    const stream = sessions.listenNotifications("connection")[Symbol.asyncIterator]();
    await sessions.subscribeWorkspace("connection", "workspace", workspace.instance, facts);
    const fact = new Committed("workspace", origin, [
      { type: "entityDeleted" as const, nodeId: "node" },
    ]);

    facts.emit(fact);
    facts.emit(fact);

    await expect(stream.next()).resolves.toMatchObject({ done: false });
    await expect(stream.next()).rejects.toThrow(/capacity/);
    sessions.release();
    await app.stop();
  });
});
