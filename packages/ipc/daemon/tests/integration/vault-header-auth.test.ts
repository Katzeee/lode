import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppServerClient, createSocketTransport, isVaultLockedError } from "@lode/client";
import { dialTarget } from "../../src/endpoint.js";
import { startAppServerDaemon, type AppServerDaemon } from "../../src/index.js";

// The Phase-2a socket-deployment auth contract: a vault-backed daemon authenticates each RPC via
// (lode-client-id, lode-actor-id) request headers, and an authed command needs the vault UNLOCKED.
// The daemon here uses the heavy default KDF (one init per test ≈ a second) — the contract under test
// is the header→vault→resolveCaller path, not KDF speed.
const PASS = "strong-passphrase-1";

describe("vault header auth (socket deployment)", () => {
  let daemon: AppServerDaemon;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "vault-auth-"));
    daemon = await startAppServerDaemon({
      listen: "tcp://127.0.0.1:0",
      vaultPath: join(dir, "vault.json"),
    });
  });

  afterEach(async () => {
    await daemon.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it("InitVault → CreateIdentity → header-authed domain command succeeds", async () => {
    const admin = new AppServerClient(createSocketTransport(dialTarget(daemon.address)));
    admin.connect();
    await admin.rpc.initVault({ passphrase: PASS });
    const { actorId } = await admin.rpc.createIdentity({ label: "alice" });

    // A client that carries (clientId, actorId) headers can run authed commands: the vault is
    // UNLOCKED and the actor's keypair is loaded.
    const authed = new AppServerClient(
      createSocketTransport(dialTarget(daemon.address), {
        headers: { "lode-client-id": "client-1", "lode-actor-id": actorId },
      }),
    );
    const ws = await authed.rpc.createWorkspace({ displayName: "Notes" });
    expect(ws.displayName).toBe("Notes");
    admin.close();
    authed.close();
  });

  it("rejects an authed command with VaultLockedError when the vault is locked", async () => {
    // Fresh vault (LOCKED, not yet initialized): no keypair in memory.
    const authed = new AppServerClient(
      createSocketTransport(dialTarget(daemon.address), {
        headers: { "lode-client-id": "client-1", "lode-actor-id": "some-actor" },
      }),
    );
    await expect(authed.rpc.createWorkspace({ displayName: "X" })).rejects.toSatisfy(
      (error: unknown) => isVaultLockedError(error),
    );
    authed.close();
  });

  it("LockVault after use re-gates authed commands", async () => {
    const admin = new AppServerClient(createSocketTransport(dialTarget(daemon.address)));
    admin.connect();
    await admin.rpc.initVault({ passphrase: PASS });
    const { actorId } = await admin.rpc.createIdentity({ label: "alice" });

    const authed = new AppServerClient(
      createSocketTransport(dialTarget(daemon.address), {
        headers: { "lode-client-id": "client-1", "lode-actor-id": actorId },
      }),
    );
    await authed.rpc.createWorkspace({ displayName: "before-lock" });

    await admin.rpc.lockVault({});
    await expect(authed.rpc.createWorkspace({ displayName: "after-lock" })).rejects.toSatisfy(
      (error: unknown) => isVaultLockedError(error),
    );
    admin.close();
    authed.close();
  });
});
