import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppServerClient, createSocketTransport, isVaultLockedError } from "@lode/client";
import { dialTarget } from "../../src/endpoint.js";
import { VaultState } from "@lode/protocol/proto";
import {
  startAppServerDaemon,
  startRelayDaemon,
  type AppServerDaemon,
  type RelayDaemon,
} from "../../src/index.js";

const PASS = "strong-passphrase-1";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Phase-2b GRACE contract end-to-end: a registered sync keeps the keys in memory past lease expiry
// (GRACE), so background rounds keep signing while interactive commands are gated (lease-expired);
// the PIN re-unlocks from GRACE without re-entering the passphrase.
describe("vault GRACE + PIN (socket deployment)", () => {
  let daemon: AppServerDaemon;
  let relay: RelayDaemon;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "vault-grace-"));
    relay = await startRelayDaemon({ relay: { port: 0 } });
    daemon = await startAppServerDaemon({
      listen: "tcp://127.0.0.1:0",
      vaultPath: join(dir, "vault.json"),
      vaultTtl: { kind: "duration", ms: 1500, sliding: true },
    });
  });

  afterEach(async () => {
    await daemon.stop();
    await relay.stop();
    await rm(dir, { recursive: true, force: true });
  });

  const authedClient = (address: string, actorId: string) =>
    new AppServerClient(
      createSocketTransport(dialTarget(address), {
        headers: { "lode-client-id": "client-1", "lode-actor-id": actorId },
      }),
    );

  it("registered sync → lease expiry is GRACE (lease-expired gate, then PIN re-unlocks)", async () => {
    const admin = new AppServerClient(createSocketTransport(dialTarget(daemon.address)));
    admin.connect();
    await admin.rpc.initVault({ passphrase: PASS });
    const { actorId } = await admin.rpc.createIdentity({ label: "alice" });
    await admin.rpc.setPin({ pin: "1234" });

    // Register sync (the actor drives a workspace over the relay) → the vault's sync detector is true.
    const authed = authedClient(daemon.address, actorId);
    const ws = await authed.rpc.createWorkspace({ displayName: "Notes" });
    await authed.rpc.registerSync({ workspaceId: ws.workspaceId, relayUrl: relay.relayUrl });

    // Wait out the (short) lease. Sync is registered → GRACE, not LOCKED.
    await sleep(1800);
    const status = await admin.rpc.getVaultStatus({});
    expect(status.state).toBe(VaultState.VAULT_GRACE);

    // An authed domain command is gated with VaultLockedError(lease-expired).
    await expect(authed.rpc.createWorkspace({ displayName: "gated" })).rejects.toSatisfy(
      (e: unknown) => isVaultLockedError(e),
    );

    // The PIN re-unlocks from GRACE (keys never left memory); interactive access resumes.
    await admin.rpc.unlockWithPin({ pin: "1234" });
    await expect(authed.rpc.createWorkspace({ displayName: "after-pin" })).resolves.toBeDefined();

    admin.close();
    authed.close();
  });

  it("no sync → lease expiry is LOCKED (cold); the passphrase re-unlocks", async () => {
    const admin = new AppServerClient(createSocketTransport(dialTarget(daemon.address)));
    admin.connect();
    await admin.rpc.initVault({ passphrase: PASS });
    const { actorId } = await admin.rpc.createIdentity({ label: "alice" });

    const authed = authedClient(daemon.address, actorId);
    await authed.rpc.createWorkspace({ displayName: "before" });

    await sleep(1800); // no sync registered → LOCKED (keys dropped)
    expect((await admin.rpc.getVaultStatus({})).state).toBe(VaultState.VAULT_LOCKED);
    await expect(authed.rpc.createWorkspace({ displayName: "after" })).rejects.toSatisfy(
      (e: unknown) => isVaultLockedError(e),
    );

    await admin.rpc.unlockVault({ passphrase: PASS }); // cold re-unlock with the passphrase
    await expect(authed.rpc.createWorkspace({ displayName: "recovered" })).resolves.toBeDefined();

    admin.close();
    authed.close();
  });
});
