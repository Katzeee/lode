import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppServerClient, createSocketTransport } from "@lode/client";
import { deriveActorKeypairFromMnemonic, generateMnemonic } from "@lode/engine";
import { startAppServerDaemon, type AppServerDaemon } from "../../src/index.js";

// The actor-authentication security contract over the real Connect transport. The happy path is
// covered elsewhere via openAuthedSession; this file nails the REJECTION path — the property that
// makes a claimed actor identity unforgeable. The daemon derives the keypair from the mnemonic; the
// identity IS the derived actor id (no declared actor to cross-check), so the only failure is a bad
// mnemonic.

describe("session authentication (mnemonic)", () => {
  let server: AppServerDaemon;
  let client: AppServerClient;

  beforeEach(async () => {
    server = await startAppServerDaemon({ listen: "tcp://127.0.0.1:0" });
    client = new AppServerClient(createSocketTransport(server.address));
    client.connect();
  });

  afterEach(async () => {
    client.close();
    await server.stop();
  });

  it("succeeds: sessionHello (mnemonic) establishes a session for the derived actor", async () => {
    const mnemonic = generateMnemonic();
    const { actorId } = deriveActorKeypairFromMnemonic(mnemonic);
    const session = await client.rpc.sessionHello({ mnemonic });
    expect(session.sessionId.length).toBeGreaterThan(0);
    expect(session.actor).toBeDefined();
    if (!session.actor) {
      throw new Error("expected session actor");
    }
    expect(session.actor.actorId).toBe(actorId);
  });

  it("rejects a hello with an invalid mnemonic (not a valid BIP-39 phrase)", async () => {
    await expect(
      client.rpc.sessionHello({ mnemonic: "this is not a valid bip39 phrase" }),
    ).rejects.toThrow(/authentication failed/);
  });

  it("still allows read RPCs before any session (auth gates writes/subscriptions, not reads)", async () => {
    await expect(client.rpc.listWorkspaces({})).resolves.toMatchObject({ workspaces: [] });
  });
});
