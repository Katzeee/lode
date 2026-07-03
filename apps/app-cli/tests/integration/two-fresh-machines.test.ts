import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppServerClient } from "@lode/client";
import { BrokerServer } from "@lode/transport";
import { deriveActorKeypairFromMnemonic, generateMnemonic } from "@lode/engine";
import { startAppServerDaemon, type AppServerDaemon } from "@lode/daemon";
import { parseCli } from "../../src/args.js";
import { executeCommand } from "../../src/commands.js";

// Test A — the SAME share→join→see flow as the binary Test B, but in-process (no spawned binaries).
// A `BrokerServer` relay + two `startAppServerDaemon` instances (owner A, member B, each with its own
// data root) are driven through the real `lode` CLI command layer (`parseCli` + `executeCommand`). Runs
// under `npm test`; the binary variant (Test B) is opt-in via `npm run test:binary`.
//
// Each side holds ONE long-lived client (connect + authenticate once), not one per command: the sync
// rounds run in the background, and churning a fresh client per command (with the notification stream +
// HTTP/2 session opening and closing) races itself into "session destroyed" under polling. A long-lived
// client is also closer to how a real UI surface behaves.

describe("two fresh machines — share→join→see (in-process)", () => {
  let relay: BrokerServer;
  let ownerD: AppServerDaemon;
  let memberD: AppServerDaemon;
  let tmpA: string;
  let tmpB: string;
  let relayUrl: string;
  let ownerClient: AppServerClient;
  let memberClient: AppServerClient;

  beforeEach(async () => {
    relay = new BrokerServer({ port: 0 });
    await relay.ready();
    relayUrl = `ws://127.0.0.1:${relay.port}`;
    tmpA = await mkdtemp(join(tmpdir(), "lode-sync-inproc-a-"));
    tmpB = await mkdtemp(join(tmpdir(), "lode-sync-inproc-b-"));
    ownerD = await startAppServerDaemon({
      listen: "tcp://127.0.0.1:0",
      dataRoot: tmpA,
      syncIntervalMs: 30,
    });
    memberD = await startAppServerDaemon({
      listen: "tcp://127.0.0.1:0",
      dataRoot: tmpB,
      syncIntervalMs: 30,
    });
    ownerClient = new AppServerClient({ url: ownerD.address });
    memberClient = new AppServerClient({ url: memberD.address });
    ownerClient.connect();
    memberClient.connect();
  });

  afterEach(async () => {
    ownerClient?.close();
    memberClient?.close();
    await ownerD.stop();
    await memberD.stop();
    await relay.close();
    await rm(tmpA, { recursive: true, force: true });
    await rm(tmpB, { recursive: true, force: true });
  });

  /** Run a `lode` command (command-first, flags-after) against an already-authenticated client. */
  const run =
    (client: AppServerClient, address: string, mnemonic: string) =>
    (...args: string[]): Promise<string> =>
      executeCommand(
        client.rpc,
        parseCli(["--url", address, "--actor-mnemonic", mnemonic, ...args]),
      );

  it("owner shares, member joins → both see each other's nodes (A→B then B→A)", async () => {
    const ownerMnemonic = generateMnemonic();
    const memberMnemonic = generateMnemonic();
    await ownerClient.authenticate({ actorMnemonic: ownerMnemonic });
    await memberClient.authenticate({ actorMnemonic: memberMnemonic });
    const ownerBe = run(ownerClient, ownerD.address, ownerMnemonic);
    const memberBe = run(memberClient, memberD.address, memberMnemonic);
    // The owner needs the member's sign pub to add them (the social re-add). Derived client-side from
    // the member's mnemonic — the same value `actor print-pub` returns over the wire.
    const memberSignPub = Buffer.from(
      deriveActorKeypairFromMnemonic(memberMnemonic).publicKey,
    ).toString("hex");

    // Owner: workspace (system-generated id) + its seeded root.
    const wsOut = await ownerBe("workspace", "create", "--name", "Shared");
    const ws = parseWorkspaceId(wsOut);
    const ownerRoot = parseRootOcc(await ownerBe("node", "list", "--workspace", ws));

    // Owner: add member, dial the relay, write a node, share the coordinate.
    await ownerBe("member", "add", "--workspace", ws, "--sign-pub", memberSignPub);
    await ownerBe("sync", "register", "--workspace", ws, "--relay", relayUrl);
    await ownerBe(
      "node",
      "create",
      "--workspace",
      ws,
      "--parent-occ",
      ownerRoot,
      "--text",
      "Hello from A",
    );
    const coord = (await ownerBe("sync", "share", "--workspace", ws)).trim();

    // A→B: member joins → sees the owner's node (Stage C auto-fires a content round; the 30ms tick is
    // only the backstop).
    await memberBe("sync", "join", "--coordinate", coord);
    const memberListing = await pollFor(
      () => memberBe("node", "list", "--workspace", ws),
      "Hello from A",
    );
    expect(memberListing).toContain("Hello from A");
    const memberRoot = parseRootOcc(memberListing);

    // B→A: member writes + both `sync now` (writes don't auto-push — T3 deferred) → owner sees it.
    await memberBe(
      "node",
      "create",
      "--workspace",
      ws,
      "--parent-occ",
      memberRoot,
      "--text",
      "Hello from B",
    );
    await memberBe("sync", "now", "--workspace", ws);
    await ownerBe("sync", "now", "--workspace", ws);
    const ownerListing = await pollFor(
      () => ownerBe("node", "list", "--workspace", ws),
      "Hello from B",
    );
    expect(ownerListing).toContain("Hello from B");
  }, 30000);
});

function parseWorkspaceId(out: string): string {
  const m = /^Created workspace .* \((?<ws>.+)\)\.$/m.exec(out);
  if (!m?.groups?.ws) {
    throw new Error(`parseWorkspaceId failed: ${out}`);
  }
  return m.groups.ws;
}

/** The root occurrence id from a `node list` output (line 1 = "root"; line 2 = "<rootOcc>  <name>"). */
function parseRootOcc(out: string): string {
  const occ = out.split("\n").at(1)?.split(/\s+/).at(0);
  if (!occ) {
    throw new Error(`no root occurrence in node list output:\n${out}`);
  }
  return occ;
}

/** Poll an async producer until its output contains `needle` or the timeout elapses. */
async function pollFor(
  fn: () => Promise<string>,
  needle: string,
  timeoutMs = 10000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const out = await fn();
    if (out.includes(needle)) {
      return out;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for "${needle}" in:\n${out}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
