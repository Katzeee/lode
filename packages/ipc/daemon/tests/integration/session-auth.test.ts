import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppServerClient } from "@lode/client";
import { generateActorKeypair, signWithActor } from "@lode/engine";
import { startAppServerDaemon, type AppServerDaemon } from "../../src/index.js";
import { tempListenUrl } from "@lode/test-utils";

// F4: the actor-authentication security contract over the real Connect transport. The happy path
// (challenge → sign → hello) is covered elsewhere via openAuthedSession; this file nails the
// REJECTION paths — the properties that make a claimed actor identity unforgeable.

describe("F4 session authentication (challenge-response)", () => {
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

  it("succeeds: sessionChallenge → sign → sessionHello establishes a session", async () => {
    const actor = generateActorKeypair();
    const { challenge } = await client.rpc.sessionChallenge({});
    const signature = signWithActor(actor.privateKey, challenge);
    const session = await client.rpc.sessionHello({
      actor: { actorId: actor.actorId, signPub: actor.publicKey },
      challenge,
      signature,
    });
    expect(session.sessionId.length).toBeGreaterThan(0);
    expect(session.actor).toBeDefined();
    if (!session.actor) {
      throw new Error("expected session actor");
    }
    expect(session.actor.actorId).toBe(actor.actorId);
  });

  it("rejects a hello with no prior sessionChallenge (challenge not issued for this connection)", async () => {
    const actor = generateActorKeypair();
    await expect(
      client.rpc.sessionHello({
        actor: { actorId: actor.actorId, signPub: actor.publicKey },
        challenge: new Uint8Array(32),
        signature: signWithActor(actor.privateKey, new Uint8Array(32)),
      }),
    ).rejects.toThrow(/authentication failed/);
  });

  it("rejects a hello signed by the WRONG key (signature does not match the declared sign_pub)", async () => {
    const actor = generateActorKeypair();
    const imposter = generateActorKeypair();
    const { challenge } = await client.rpc.sessionChallenge({});
    const signature = signWithActor(imposter.privateKey, challenge); // signed by a different key
    await expect(
      client.rpc.sessionHello({
        actor: { actorId: actor.actorId, signPub: actor.publicKey },
        challenge,
        signature,
      }),
    ).rejects.toThrow(/authentication failed/);
  });

  it("rejects a REUSED challenge (single-use: a second hello with the same nonce fails)", async () => {
    const actor = generateActorKeypair();
    const { challenge } = await client.rpc.sessionChallenge({});
    const signature = signWithActor(actor.privateKey, challenge);
    await client.rpc.sessionHello({
      actor: { actorId: actor.actorId, signPub: actor.publicKey },
      challenge,
      signature,
    });
    await expect(
      client.rpc.sessionHello({
        actor: { actorId: actor.actorId, signPub: actor.publicKey },
        challenge,
        signature,
      }),
    ).rejects.toThrow(/authentication failed/);
  });

  it("rejects a hello whose actor carries no sign_pub (no key to verify against)", async () => {
    const { challenge } = await client.rpc.sessionChallenge({});
    await expect(
      client.rpc.sessionHello({
        actor: { actorId: "nobody" },
        challenge,
        signature: new Uint8Array(64),
      }),
    ).rejects.toThrow(/authentication failed/);
  });

  it("still allows read RPCs before any session (auth gates writes/subscriptions, not reads)", async () => {
    await expect(client.rpc.listWorkspaces({})).resolves.toMatchObject({ workspaces: [] });
  });
});
