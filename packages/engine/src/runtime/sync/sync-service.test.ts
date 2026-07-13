import { randomUUID } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import {
  SessionHelloRequestSchema,
  CreateWorkspaceRequestSchema,
  RemoveWorkspaceRequestSchema,
} from "@lode/protocol/proto";
import { afterEach, describe, expect, it } from "vitest";
import { deriveActorKeypair } from "../identity/identity-policy.js";
import { generateMnemonic, type ActorKeypair } from "../../crypto/index.js";
import { BrokerServer } from "../broker/broker-server.js";
import { createBrokerSyncTransport } from "./adapters/broker-sync-transport.js";
import { AppRuntime } from "../kernel/app-runtime.js";
import { WorkspaceRegistry } from "../workspace/registry.js";
import { ClientSessionManager } from "../session/client-session-manager.js";
import { SyncService } from "./sync-service.js";
import { wrapCommands } from "../../commands/wrap-commands.js";
import { createCommands, type CommandDeps, type Commands } from "../../commands/index.js";
import { createSessionRpcs } from "../../commands/session-rpcs.js";

// Engine-level coverage for the SyncRegistry sub-graph (no daemon). The full sealed two-peer
// convergence flow is covered by the daemon e2e (`sync-secured-e2e.test.ts`); driving it in-process
// here trips a loro re-entrancy guard (reading a partially-converged occurrence's deltas while a
// sync round runs), unrelated to the sub-graph under test. These tests cover the registry + sub-graph
// LIFECYCLE — register wires a workspace-owned sync instance,
// shareCoordinate/syncNow gate correctly, stop tears everything down without hanging.
//
// SyncRegistry is engine-internal (NOT on the EngineRuntime host surface — hosts reach sync via the
// `commands` bag), so this co-located test builds the subsystems directly to hold a `sync` reference
// (incl. its `wiredSyncApp` observability seam, which has no RPC equivalent). Workspace + session
// ops still go through `commands` (the single client route).

const WS = "ws-sync-unit";

let relay: BrokerServer | undefined;

type TestRuntime = { commands: Commands; app: AppRuntime; sync: SyncService };
const runtimes: TestRuntime[] = [];

afterEach(async () => {
  for (const r of runtimes.splice(0)) {
    await r.app.stop();
  }
  if (relay) {
    await relay.close();
    relay = undefined;
  }
});

// Mirrors createEngineRuntime's assembly but exposes `sync` for direct registry testing. In-memory only
// (these tests never persist); the round interval is short so rounds drive promptly.
async function buildRuntime(roundIntervalMs = 30): Promise<TestRuntime> {
  const app = new AppRuntime("test-engine");
  const workspaces = (
    await app.root.mount("component:workspaces", (instance) => WorkspaceRegistry.inMemory(instance))
  ).api;
  const sessions = (
    await app.root.mount("component:sessions", (instance) => {
      const service = new ClientSessionManager(instance, workspaces.originLabel());
      instance.own(service);
      return service;
    })
  ).api;
  const sync = (
    await app.root.mount("component:sync", (instance) => {
      const service = new SyncService({
        workspaces,
        transportFactory: createBrokerSyncTransport,
        roundIntervalMs,
      });
      instance.own(service);
      return service;
    })
  ).api;
  const ctx: CommandDeps = { workspaces, sync };
  const commands = wrapCommands(
    { ...createCommands(ctx), ...createSessionRpcs(sessions, workspaces) },
    sessions,
  );
  return { commands, app, sync };
}

// The single route a host uses: sessionHello derives the keypair the session holds, and that SAME
// keypair owns the workspace (createWorkspace) + signs sync rounds (registerSync). Returns the
// pre-derived keypair so a test can register sync with the owner's identity.
async function ownerSession(
  runtime: TestRuntime,
): Promise<{ connectionId: string; keypair: ActorKeypair }> {
  const mnemonic = generateMnemonic();
  const keypair = deriveActorKeypair(mnemonic);
  const connectionId = randomUUID();
  await runtime.commands.sessionHello(
    create(SessionHelloRequestSchema, { mnemonic }),
    connectionId,
  );
  return { connectionId, keypair };
}

async function createWorkspace(
  runtime: TestRuntime,
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
  runtime: TestRuntime,
  connectionId: string,
  workspaceId: string,
): Promise<void> {
  await runtime.commands.removeWorkspace(
    create(RemoveWorkspaceRequestSchema, { workspaceId }),
    connectionId,
  );
}

describe("SyncService — lifecycle + ownership", () => {
  it("register wires a sync instance; shareCoordinate + syncNow gate; stop tears down without hanging", async () => {
    relay = new BrokerServer({ port: 0 });
    await relay.ready();
    const url = `http://127.0.0.1:${relay.port}`;

    const owner = await buildRuntime();
    runtimes.push(owner);
    await owner.app.start();

    const { connectionId: ownerConn, keypair: ownerKp } = await ownerSession(owner);
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

    const owner = await buildRuntime();
    runtimes.push(owner);
    await owner.app.start();

    const { connectionId: ownerConn, keypair: ownerKp } = await ownerSession(owner);
    await createWorkspace(owner, ownerConn, WS, "x");
    await owner.sync.registerSync(WS, url, ownerKp);

    // A different actor re-registering the owner's workspace is refused (would overwrite the owner's
    // captured keypair that signs rounds + wires wire security). The same actor re-registering is
    // idempotent.
    const intruderKp = (await ownerSession(owner)).keypair;
    await expect(owner.sync.registerSync(WS, url, intruderKp)).rejects.toThrow(
      /already registered by actor/,
    );
    await expect(owner.sync.registerSync(WS, url, ownerKp)).resolves.toBeUndefined();

    // The owner's registration survives — it can still share the workspace.
    expect(owner.sync.shareCoordinate(WS)).toEqual({ relayUrl: url, workspaceId: WS });
  });
});

describe("removeWorkspace — per-workspace teardown funnel", () => {
  it("purges the sync registration; a same-id rebuild re-registers clean (no ghost)", async () => {
    relay = new BrokerServer({ port: 0 });
    await relay.ready();
    const url = `http://127.0.0.1:${relay.port}`;

    const owner = await buildRuntime();
    runtimes.push(owner);
    await owner.app.start();

    const { connectionId: ownerConn, keypair: ownerKp } = await ownerSession(owner);
    await createWorkspace(owner, ownerConn, WS);
    await owner.sync.registerSync(WS, url, ownerKp);
    await owner.sync.syncNow(WS); // registered → the round drives (transient failures swallowed)

    // removeWorkspace funnels through the death point: the registration is purged, so a stale
    // syncNow no longer drives a dead workspace (pre-fix it stayed registered → ghost).
    await removeWorkspace(owner, ownerConn, WS);
    await expect(owner.sync.syncNow(WS)).rejects.toThrow(/not registered/);

    // Same-id rebuild starts clean — no stale instance handle or ownership clash from the dead ws.
    await createWorkspace(owner, ownerConn, WS, "rebuilt");
    await owner.sync.registerSync(WS, url, ownerKp);
    await expect(owner.sync.syncNow(WS)).resolves.toBeUndefined();
  }, 15000);
});
