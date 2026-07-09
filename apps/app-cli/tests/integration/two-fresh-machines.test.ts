import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppServerClient, createSocketTransport } from "@lode/client";
import { BrokerServer, generateMnemonic } from "@lode/engine";
import { startAppServerDaemon, type AppServerDaemon } from "@lode/daemon";
import { parseCli } from "../../src/args.js";
import { executeCommand } from "../../src/commands.js";

// Test A — the SAME share→join→see flow as the binary Test B, but in-process (no spawned binaries).
// A `BrokerServer` relay + two `startAppServerDaemon` instances (owner A, member B, each with its own
// data root) are driven through the real `lode` CLI command layer (`parseCli` + `executeCommand`). Runs
// under `npm test`; the binary variant (Test B) is opt-in via `npm run test:binary`.
//
// Each side holds ONE long-lived client (connect + authenticate once), not one per command. This is a
// test-harness choice for the in-process shape, NOT a property of the per-command client pattern the
// real `lode` binary uses: that pattern (one Node process per invocation) is immune because process
// exit tears the HTTP/2 socket down before the next invocation opens one. But here, many clients live
// in ONE process and `pollFor` cycles them while a background sync tick fires — their asynchronous
// teardown (close → sessionManager.abort) can overlap the next open and surface "session destroyed." A
// long-lived client sidesteps that and is also closer to how a real UI surface behaves.

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
    relayUrl = `http://127.0.0.1:${relay.port}`;
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
    ownerClient = new AppServerClient(createSocketTransport(ownerD.address));
    memberClient = new AppServerClient(createSocketTransport(memberD.address));
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
    // The member exports their identity as ONE opaque token, hands it to the owner out-of-band.
    const memberToken = await memberBe("identity", "export");

    // Owner: workspace (system-generated id) + its seeded root.
    const wsOut = await ownerBe("workspace", "create", "--name", "Shared");
    const ws = parseWorkspaceId(wsOut);
    const ownerRoot = parseRootOcc(await ownerBe("node", "list", "--workspace", ws));

    // Owner: add member from the token, dial the relay, write a node, share the coordinate.
    await ownerBe("member", "add", "--workspace", ws, "--identity", memberToken.trim());
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

    // A→B: member joins → sees the owner's node. Stage C's auto-fire is the likely carrier, but with
    // `syncIntervalMs: 30` the tick would also converge it — Test A locks the CLI flow end-to-end, it
    // does NOT isolate Stage C (the starved-tick test in sync-secured-e2e.test.ts does that). Sync isn't
    // instantaneous (the join's content round is fire-and-forget), so wait for it to land before reading
    // — reading mid-round hits a child whose content shard hasn't arrived yet ("entity not found"),
    // which is the correct "not here yet," not a bug.
    await memberBe("sync", "join", "--coordinate", coord);
    await sleep(1000);
    const memberListing = await memberBe("node", "list", "--workspace", ws);
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
    await sleep(1000);
    const ownerListing = await ownerBe("node", "list", "--workspace", ws);
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

/** Wait `ms` milliseconds. Used to let an asynchronous sync round (the join's fire-and-forget round,
 *  or a just-triggered `sync now`) finish before the test reads — sync isn't instantaneous. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
