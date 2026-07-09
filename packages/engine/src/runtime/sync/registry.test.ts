import { randomUUID } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import {
  SessionHelloRequestSchema,
  CreateWorkspaceRequestSchema,
  RemoveWorkspaceRequestSchema,
} from "@lode/protocol/proto";
import { afterEach, describe, expect, it } from "vitest";
import { deriveActorKeypair } from "../../session/identity-policy.js";
import { generateMnemonic, type ActorKeypair } from "../../utils/crypto/index.js";
import { createAppRuntime, type AppRuntime } from "../app-runtime.js";
import { BrokerServer } from "../broker/broker-server.js";

// Engine-level coverage for the SyncRegistry sub-graph (no daemon). The full sealed two-peer
// convergence flow is covered by the daemon e2e (`sync-secured-e2e.test.ts`); driving it in-process
// here trips a loro re-entrancy guard (reading a partially-converged occurrence's deltas while a
// sync round runs), unrelated to the sub-graph under test. These tests cover the registry + sub-graph
// LIFECYCLE — the mechanics unique to the extracted code: register wires a per-workspace sync App,
// shareCoordinate/syncNow gate correctly, stop tears everything down without hanging.
//
// Workspaces are created/removed through `commands` (the single client route) — the workspace
// registry is engine-internal, not on the host surface, so there is no second path to reach it.

const WS = "ws-sync-unit";

let relay: BrokerServer | undefined;
const runtimes: AppRuntime[] = [];

afterEach(async () => {
  for (const r of runtimes.splice(0)) {
    await r.app.stop();
  }
  if (relay) {
    await relay.close();
    relay = undefined;
  }
});

// The single route a host uses: sessionHello derives the keypair the session holds, and that SAME
// keypair owns the workspace (createWorkspace) + signs sync rounds (registerSync). Returns both so a
// test can register sync with the owner's identity.
function ownerSession(runtime: AppRuntime): { connectionId: string; keypair: ActorKeypair } {
  const mnemonic = generateMnemonic();
  const keypair = deriveActorKeypair(mnemonic);
  const connectionId = randomUUID();
  runtime.sessions.createSession(
    connectionId,
    create(SessionHelloRequestSchema, { mnemonic }),
    keypair,
  );
  return { connectionId, keypair };
}

async function createWorkspace(
  runtime: AppRuntime,
  connectionId: string,
  workspaceId: string,
  displayName = "shared",
): Promise<void> {
  await runtime.commands.createWorkspace(
    create(CreateWorkspaceRequestSchema, { workspaceId, displayName }),
    connectionId,
  );
}

async function removeWorkspace(
  runtime: AppRuntime,
  connectionId: string,
  workspaceId: string,
): Promise<void> {
  await runtime.commands.removeWorkspace(
    create(RemoveWorkspaceRequestSchema, { workspaceId }),
    connectionId,
  );
}

describe("SyncRegistry — lifecycle + ownership", () => {
  it("register wires a sync App; shareCoordinate + syncNow gate; stop tears down without hanging", async () => {
    relay = new BrokerServer({ port: 0 });
    await relay.ready();
    const url = `http://127.0.0.1:${relay.port}`;

    const owner = await createAppRuntime({ sync: { roundIntervalMs: 30 } });
    runtimes.push(owner);
    await owner.app.start();

    const { connectionId: ownerConn, keypair: ownerKp } = ownerSession(owner);
    await createWorkspace(owner, ownerConn, WS);

    // shareCoordinate refuses before the workspace is synced to a relay.
    expect(() => owner.sync.shareCoordinate(WS)).toThrow(/not synced to a relay/);

    // syncNow refuses for a workspace that was never registered.
    await expect(owner.sync.syncNow(WS)).rejects.toThrow(/not registered/);

    // registerSync wires the per-workspace sub-graph (context + driver + push) against the relay.
    await owner.sync.registerSync(WS, url, ownerKp);

    // shareCoordinate now resolves with the captured relay URL + workspace id.
    expect(owner.sync.shareCoordinate(WS)).toEqual({ relayUrl: url, workspaceId: WS });

    // syncNow for the registered workspace drives one round through the new driver and resolves
    // (transient round failures are swallowed inside the driver — it never rejects here).
    await expect(owner.sync.syncNow(WS)).resolves.toBeUndefined();

    // app.stop aborts the registry's wire poll + the per-workspace driver run loop + closes the
    // transport, and completes well within the run-settle deadline (no hang).
    const before = Date.now();
    await owner.app.stop();
    expect(Date.now() - before).toBeLessThan(5000);
  }, 15000);

  it("refuses a second, different actor re-registering a workspace (ownership guard)", async () => {
    relay = new BrokerServer({ port: 0 });
    await relay.ready();
    const url = `http://127.0.0.1:${relay.port}`;

    const owner = await createAppRuntime({ sync: { roundIntervalMs: 30 } });
    runtimes.push(owner);
    await owner.app.start();

    const { connectionId: ownerConn, keypair: ownerKp } = ownerSession(owner);
    await createWorkspace(owner, ownerConn, WS, "x");
    await owner.sync.registerSync(WS, url, ownerKp);

    // A different actor re-registering the owner's workspace is refused (would overwrite the owner's
    // captured keypair that signs rounds + wires wire security). The same actor re-registering is
    // idempotent.
    const intruderKp = ownerSession(owner).keypair;
    await expect(owner.sync.registerSync(WS, url, intruderKp)).rejects.toThrow(
      /already registered by actor/,
    );
    await expect(owner.sync.registerSync(WS, url, ownerKp)).resolves.toBeUndefined();

    // The owner's registration survives — it can still share the workspace.
    expect(owner.sync.shareCoordinate(WS)).toEqual({ relayUrl: url, workspaceId: WS });
  });

  it("removeWorkspace tears down the sync sub-graph — engine+store+sync in one app.stop()", async () => {
    relay = new BrokerServer({ port: 0 });
    await relay.ready();
    const url = `http://127.0.0.1:${relay.port}`;
    const owner = await createAppRuntime({ sync: { roundIntervalMs: 30 } });
    runtimes.push(owner);
    await owner.app.start();

    const { connectionId: ownerConn, keypair: ownerKp } = ownerSession(owner);
    await createWorkspace(owner, ownerConn, WS, "x");
    await owner.sync.registerSync(WS, url, ownerKp);

    // The sync sub-graph wires as a CHILD of the workspace's ChildApp (linked by a holder component).
    const pollUntil = async (pred: () => boolean, ms: number): Promise<void> => {
      const end = Date.now() + ms;
      while (!pred() && Date.now() < end) {
        await new Promise((r) => setTimeout(r, 10));
      }
    };
    await pollUntil(() => owner.sync.wiredSyncApp(WS) !== null, 3000);
    const syncApp = owner.sync.wiredSyncApp(WS)!;
    expect(syncApp.isStopped).toBe(false); // the sub-graph is running (transport + tick alive)

    // removeWorkspace stops the workspace ChildApp → the holder stops the nested sync sub-graph. Pre-fix
    // the sub-graph was a sibling under the root App, so it kept ticking against the disposed engine.
    await removeWorkspace(owner, ownerConn, WS);
    expect(owner.sync.wiredSyncApp(WS)).toBeNull(); // the registration (engine + sub-graph) is gone
    expect(syncApp.isStopped).toBe(true); // …and the sync sub-graph stopped with it — no leak
  }, 15000);
});

describe("removeWorkspace — per-workspace teardown funnel", () => {
  it("purges the sync registration; a same-id rebuild re-registers clean (no ghost)", async () => {
    relay = new BrokerServer({ port: 0 });
    await relay.ready();
    const url = `http://127.0.0.1:${relay.port}`;

    const owner = await createAppRuntime({ sync: { roundIntervalMs: 30 } });
    runtimes.push(owner);
    await owner.app.start();

    const { connectionId: ownerConn, keypair: ownerKp } = ownerSession(owner);
    await createWorkspace(owner, ownerConn, WS);
    await owner.sync.registerSync(WS, url, ownerKp);
    await owner.sync.syncNow(WS); // registered → the round drives (transient failures swallowed)

    // removeWorkspace funnels through the death point: the registration is purged, so a stale
    // syncNow no longer drives a dead workspace (pre-fix it stayed registered → ghost).
    await removeWorkspace(owner, ownerConn, WS);
    await expect(owner.sync.syncNow(WS)).rejects.toThrow(/not registered/);

    // Same-id rebuild starts clean — no stale syncApp handle / ownership clash from the dead ws.
    await createWorkspace(owner, ownerConn, WS, "rebuilt");
    await owner.sync.registerSync(WS, url, ownerKp);
    await expect(owner.sync.syncNow(WS)).resolves.toBeUndefined();
  }, 15000);
});
