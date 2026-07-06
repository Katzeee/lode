import { afterEach, describe, expect, it } from "vitest";
import { generateActorKeypair } from "../../utils/crypto/index.js";
import { createAppRuntime, type AppRuntime } from "../app-runtime.js";
import { BrokerServer } from "../broker/broker-server.js";

// Engine-level coverage for the new SyncRegistry sub-graph (no daemon). The full sealed
// two-peer convergence flow is covered by the daemon e2e (`sync-secured-e2e.test.ts`), which
// switches onto this registry in Phase 1d — driving it in-process here trips a loro re-entrancy
// guard (reading a partially-converged occurrence's deltas while a sync round runs), unrelated to
// the sub-graph under test. These tests cover the registry + sub-graph LIFECYCLE — the mechanics
// unique to the extracted code: register wires a per-workspace sync App, shareCoordinate/syncNow
// gate correctly, stop tears everything down without hanging.

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

describe("SyncRegistry — lifecycle + ownership", () => {
  it("register wires a sync App; shareCoordinate + syncNow gate; stop tears down without hanging", async () => {
    relay = new BrokerServer({ port: 0 });
    await relay.ready();
    const url = `http://127.0.0.1:${relay.port}`;

    const owner = await createAppRuntime({ sync: { roundIntervalMs: 30 } });
    runtimes.push(owner);
    await owner.app.start();

    const ownerKp = generateActorKeypair();
    await owner.workspaces.createWorkspace({
      workspaceId: WS,
      displayName: "shared",
      actorKeypair: ownerKp,
    });

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

    const ownerKp = generateActorKeypair();
    await owner.workspaces.createWorkspace({
      workspaceId: WS,
      displayName: "x",
      actorKeypair: ownerKp,
    });
    await owner.sync.registerSync(WS, url, ownerKp);

    // A different actor re-registering the owner's workspace is refused (would overwrite the owner's
    // captured keypair that signs rounds + wires wire security). The same actor re-registering is
    // idempotent.
    const intruderKp = generateActorKeypair();
    await expect(owner.sync.registerSync(WS, url, intruderKp)).rejects.toThrow(
      /already registered by actor/,
    );
    await expect(owner.sync.registerSync(WS, url, ownerKp)).resolves.toBeUndefined();

    // The owner's registration survives — it can still share the workspace.
    expect(owner.sync.shareCoordinate(WS)).toEqual({ relayUrl: url, workspaceId: WS });
  });
});
