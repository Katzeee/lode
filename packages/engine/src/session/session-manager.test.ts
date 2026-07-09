import { create } from "@bufbuild/protobuf";
import { NodeUpdatedPayloadSchema, SessionHelloRequestSchema } from "@lode/protocol/proto";
import { describe, expect, it } from "vitest";
import { generateActorKeypair } from "../utils/crypto/index.js";
import { SessionManager, SessionRequiredError } from "./session-manager.js";

describe("SessionManager — getActorPublicKeys", () => {
  it("returns the session actor's id + sign pub (retained at createSession)", () => {
    const sessions = new SessionManager("node-1");
    const actor = generateActorKeypair();
    sessions.createSession(
      "conn-1",
      create(SessionHelloRequestSchema, { mnemonic: "ignored by the manager" }),
      actor,
    );
    expect(sessions.getActorPublicKeys("conn-1")).toEqual({
      actorId: actor.actorId,
      signPub: actor.publicKey,
    });
  });

  it("retains the full keypair (createWorkspace signs as this actor)", () => {
    const sessions = new SessionManager("node-1");
    const actor = generateActorKeypair();
    sessions.createSession("conn-1", create(SessionHelloRequestSchema, { mnemonic: "x" }), actor);
    expect(sessions.getActorKeypair("conn-1")).toEqual({ actorId: actor.actorId, keypair: actor });
  });

  it("throws SessionRequiredError without a verified session", () => {
    const sessions = new SessionManager("node-1");
    expect(() => sessions.getActorPublicKeys("missing")).toThrow(SessionRequiredError);
  });
});

describe("SessionManager — purgeWorkspace", () => {
  it("drops the subscriber set so broadcasts no longer reach those connections", () => {
    const sessions = new SessionManager("node-1");
    const actor = generateActorKeypair();
    sessions.createSession("conn-1", create(SessionHelloRequestSchema, { mnemonic: "x" }), actor);
    sessions.subscribeDoc("conn-1", "ws-A");
    const stream = sessions.getOrCreateStream("conn-1");
    const pushed: number[] = [];
    // Spy on the stream the manager holds — broadcastNodeUpdated pushes to it per subscriber.
    stream.push = () => {
      pushed.push(1);
    };

    const origin = sessions.requireOrigin("conn-1");
    const payload = create(NodeUpdatedPayloadSchema, {});
    sessions.broadcastNodeUpdated("ws-A", [payload], origin);
    expect(pushed).toHaveLength(1); // subscribed → the broadcast reached the stream

    sessions.purgeWorkspace("ws-A");
    sessions.broadcastNodeUpdated("ws-A", [payload], origin);
    expect(pushed).toHaveLength(1); // purged → the second broadcast reached nobody
  });
});

describe("SessionManager — close (lifecycle teardown)", () => {
  it("completes every open notification stream", async () => {
    const sessions = new SessionManager("node-1");
    sessions.createSession(
      "conn-1",
      create(SessionHelloRequestSchema, { mnemonic: "x" }),
      generateActorKeypair(),
    );
    const iter = sessions.getOrCreateStream("conn-1")[Symbol.asyncIterator]();
    sessions.close();
    await expect(iter.next()).resolves.toEqual({ value: undefined, done: true });
  });

  it("clears all bookkeeping so a post-close broadcast reaches nobody", () => {
    const sessions = new SessionManager("node-1");
    const actor = generateActorKeypair();
    sessions.createSession("conn-1", create(SessionHelloRequestSchema, { mnemonic: "x" }), actor);
    sessions.subscribeDoc("conn-1", "ws-A");
    const stream = sessions.getOrCreateStream("conn-1");
    let pushes = 0;
    stream.push = () => {
      pushes++;
    };
    const origin = { nodeId: "node-1", actorId: actor.actorId, sessionId: "s" };
    const payload = create(NodeUpdatedPayloadSchema, {});
    sessions.broadcastNodeUpdated("ws-A", [payload], origin);
    expect(pushes).toBe(1);

    sessions.close();
    sessions.broadcastNodeUpdated("ws-A", [payload], origin);
    expect(pushes).toBe(1); // subscribers cleared → the post-close broadcast reached nobody
  });
});
