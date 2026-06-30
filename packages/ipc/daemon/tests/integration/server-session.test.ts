import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppServerClient } from "@lode/client";
import { generateActorKeypair, signWithActor } from "@lode/engine";
import type { Notification, NodeOccurrenceWire } from "@lode/protocol/proto";
import { startAppServerDaemon, type AppServerDaemon } from "../../src/index.js";
import { tempListenUrl } from "@lode/test-utils";
import { openAuthedSession } from "./authed-session.js";

const WORKSPACE_ID = "ws_main";

describe("AppServer sessions and notifications", () => {
  let server: AppServerDaemon;
  let client: AppServerClient;

  beforeEach(async () => {
    server = await startAppServerDaemon({ listen: tempListenUrl() });
    client = new AppServerClient({ url: server.address });
    client.connect();
  });

  afterEach(async () => {
    client.close();
    await server.stop();
  });

  it("rejects write RPCs before session hello", async () => {
    await expect(
      client.rpc.createWorkspaceDoc({ workspaceId: WORKSPACE_ID, docId: "main" }),
    ).rejects.toThrow("Session handshake required");
  });

  it("allows read RPCs before session hello", async () => {
    await expect(client.rpc.listWorkspaces({})).resolves.toMatchObject({ workspaces: [] });
  });

  it("session.hello returns the established session", async () => {
    const { session, actor } = await openAuthedSession(client, {
      displayName: "Actor One",
      client: { name: "vitest" },
    });

    expect(session.sessionId.length).toBeGreaterThan(0);
    expect(session.actor).toBeDefined();
    if (!session.actor) {
      throw new Error("expected session actor");
    }
    expect(session.actor).toMatchObject({ actorId: actor.actorId, displayName: "Actor One" });
    expect(session.actor.signPub).toEqual(actor.publicKey);
    expect(session.client).toMatchObject({ name: "vitest" });
    expect(typeof session.connectedAt).toBe("bigint");
  });

  it("doc.subscribe requires a session", async () => {
    await expect(client.rpc.subscribeDoc({ workspaceId: WORKSPACE_ID })).rejects.toThrow(
      "Session handshake required",
    );
  });

  it("broadcasts node.updated with origin to subscribed sessions including the writer", async () => {
    const writerActor = await hello(client, "writer");
    await createWorkspaceAndDoc(client);
    await client.rpc.subscribeDoc({ workspaceId: WORKSPACE_ID });

    const observer = new AppServerClient({ url: server.address });
    observer.connect();
    await hello(observer, "observer");
    await observer.rpc.subscribeDoc({ workspaceId: WORKSPACE_ID });

    const notifications = Promise.all([waitForNotification(client), waitForNotification(observer)]);
    const node = await client.rpc.createPlainNode({
      workspaceId: WORKSPACE_ID,
    });
    const [writerNotification, observerNotification] = await notifications;

    expectNodeUpdated(writerNotification, node, writerActor);
    expectNodeUpdated(observerNotification, node, writerActor);

    observer.close();
  });

  it("removes subscriptions when a connection closes", async () => {
    await hello(client, "writer");
    await createWorkspaceAndDoc(client);

    const observer = new AppServerClient({ url: server.address });
    observer.connect();
    await hello(observer, "observer");
    await observer.rpc.subscribeDoc({ workspaceId: WORKSPACE_ID });
    observer.close();

    await client.rpc.subscribeDoc({ workspaceId: WORKSPACE_ID });
    const writerNotification = waitForNotification(client);
    await client.rpc.createPlainNode({ workspaceId: WORKSPACE_ID });
    const notification = await writerNotification;
    expect(notification.workspaceId).toBe(WORKSPACE_ID);
  });
});

async function hello(client: AppServerClient, _actorId = "test-actor"): Promise<string> {
  const { actor } = await openAuthedSession(client, { client: { name: "vitest" } });
  return actor.actorId;
}

function waitForNotification(client: AppServerClient): Promise<Notification> {
  return new Promise((resolve, reject) => {
    let off = (): void => {};
    const timeout = setTimeout(() => {
      off();
      reject(new Error("notification timed out"));
    }, 500);
    off = client.onNotification((notification) => {
      clearTimeout(timeout);
      off();
      resolve(notification);
    });
  });
}

function expectNodeUpdated(
  notification: Notification,
  node: NodeOccurrenceWire,
  actorId: string,
): void {
  expect(notification.workspaceId).toBe(WORKSPACE_ID);
  const origin = notification.origin;
  expect(origin).toBeDefined();
  expect(origin!.nodeId.length).toBeGreaterThan(0);
  expect(origin!.actorId).toBe(actorId);
  expect(origin!.sessionId.length).toBeGreaterThan(0);
  expect(
    notification.payloads.some(
      (payload) =>
        payload.variant.case === "entityAdded" &&
        payload.variant.value.nodeId === node.nodeId &&
        payload.variant.value.occurrenceId === node.occurrenceId,
    ),
  ).toBe(true);
}

async function createWorkspaceAndDoc(client: AppServerClient): Promise<void> {
  await client.rpc.createWorkspace({
    workspaceId: WORKSPACE_ID,
    displayName: "Test Workspace",
  });
  await client.rpc.createWorkspaceDoc({
    workspaceId: WORKSPACE_ID,
    docId: "main",
    displayName: "Main",
  });
}

describe("F4 actor authentication (challenge-response)", () => {
  let server: AppServerDaemon;
  let client: AppServerClient;

  beforeEach(async () => {
    server = await startAppServerDaemon({ listen: tempListenUrl() });
    client = new AppServerClient({ url: server.address });
    client.connect();
  });

  afterEach(async () => {
    client.close();
    await server.stop();
  });

  it("rejects sessionHello with no challenge (actor didn't prove key ownership)", async () => {
    const actor = generateActorKeypair();
    await expect(
      client.rpc.sessionHello({ actor: { actorId: actor.actorId, signPub: actor.publicKey } }),
    ).rejects.toThrow();
  });

  it("rejects sessionHello signed by the wrong key (forged signature)", async () => {
    const { challenge } = await client.rpc.sessionChallenge({});
    const claimed = generateActorKeypair();
    const impostor = generateActorKeypair();
    const signature = signWithActor(impostor.privateKey, challenge); // a DIFFERENT key signed
    await expect(
      client.rpc.sessionHello({
        actor: { actorId: claimed.actorId, signPub: claimed.publicKey },
        challenge,
        signature,
      }),
    ).rejects.toThrow();
  });

  it("rejects an actor id that does not match the declared signing public key", async () => {
    const { challenge } = await client.rpc.sessionChallenge({});
    const signer = generateActorKeypair();
    const claimed = generateActorKeypair();
    await expect(
      client.rpc.sessionHello({
        actor: { actorId: claimed.actorId, signPub: signer.publicKey },
        challenge,
        signature: signWithActor(signer.privateKey, challenge),
      }),
    ).rejects.toThrow();
  });

  it("rejects a replayed challenge (single-use nonce)", async () => {
    const actor = generateActorKeypair();
    const { challenge } = await client.rpc.sessionChallenge({});
    const signature = signWithActor(actor.privateKey, challenge);
    // First hello consumes the challenge + creates the session...
    await client.rpc.sessionHello({
      actor: { actorId: actor.actorId, signPub: actor.publicKey },
      challenge,
      signature,
    });
    // ...replaying the SAME challenge + signature is rejected (the nonce is single-use).
    await expect(
      client.rpc.sessionHello({
        actor: { actorId: actor.actorId, signPub: actor.publicKey },
        challenge,
        signature,
      }),
    ).rejects.toThrow();
  });
});
