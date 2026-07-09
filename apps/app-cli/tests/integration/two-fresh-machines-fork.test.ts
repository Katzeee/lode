import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppServerClient, createSocketTransport } from "@lode/client";
import { BrokerServer, generateMnemonic } from "@lode/engine";
import { startAppServerDaemon, type AppServerDaemon } from "@lode/daemon";
import { parseCli } from "../../src/args.js";
import { executeCommand } from "../../src/commands.js";

// The Phase 3 recovery flow (design sync-identity-persistence §13): a kicked member retains their
// local copy (local-first — replicated data can't be recalled) and FORKS it into a new workspace
// where they are the owner. One mechanism covers kicked / lost-owner / rogue-owner. This drives the
// real CLI command layer over two in-process daemons + a relay: share→join→sync, owner kicks the
// member, the member forks, and the fork must carry the full synced content + a fresh epoch-0 root
// owned by the forker. Same harness shape as two-fresh-machines.test.ts; the binary twin is opt-in.

describe("two fresh machines — kicked member forks (in-process)", () => {
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
    tmpA = await mkdtemp(join(tmpdir(), "lode-fork-a-"));
    tmpB = await mkdtemp(join(tmpdir(), "lode-fork-b-"));
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

  const run =
    (client: AppServerClient, address: string, mnemonic: string) =>
    (...args: string[]): Promise<string> =>
      executeCommand(
        client.rpc,
        parseCli(["--url", address, "--actor-mnemonic", mnemonic, ...args]),
      );

  it("a kicked member forks their local copy into a new owner workspace with full content", async () => {
    const ownerMnemonic = generateMnemonic();
    const memberMnemonic = generateMnemonic();
    await ownerClient.authenticate({ actorMnemonic: ownerMnemonic });
    await memberClient.authenticate({ actorMnemonic: memberMnemonic });
    const ownerBe = run(ownerClient, ownerD.address, ownerMnemonic);
    const memberBe = run(memberClient, memberD.address, memberMnemonic);

    const memberToken = await memberBe("identity", "export");

    // Owner: workspace + add member + dial relay + write a node + share.
    const ws = parseWorkspaceId(await ownerBe("workspace", "create", "--name", "Shared"));
    const ownerRoot = parseRootOcc(await ownerBe("node", "list", "--workspace", ws));
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
      "secret from Alice",
    );
    const coord = (await ownerBe("sync", "share", "--workspace", ws)).trim();

    // Member joins, sees Alice's node, then writes their own + syncs back. After this the member has
    // BOTH nodes in their local replica — the body of content the fork must carry.
    await memberBe("sync", "join", "--coordinate", coord);
    await sleep(1000);
    const memberRoot = parseRootOcc(await memberBe("node", "list", "--workspace", ws));
    await memberBe(
      "node",
      "create",
      "--workspace",
      ws,
      "--parent-occ",
      memberRoot,
      "--text",
      "secret from Bob",
    );
    await memberBe("sync", "now", "--workspace", ws);
    await ownerBe("sync", "now", "--workspace", ws);
    await sleep(1000);

    // The member's actorId (a non-owner line in the roster) — needed for the kick.
    const roster = await ownerBe("member", "list", "--workspace", ws);
    const memberActor = parseNonOwnerActor(roster);

    // Owner kicks the member. The member does NOT need to receive the revoke — fork is local: it
    // copies the member's already-synced replica. (Local-first: data already replicated is kept.)
    await ownerBe("member", "remove", "--workspace", ws, "--actor", memberActor);

    // Member forks their local copy into a fresh workspace where they are the owner.
    const forked = parseForkedWorkspaceId(
      await memberBe("workspace", "fork", "--workspace", ws, "--name", "Recovered"),
    );

    // The fork carries the full synced content — both Alice's and Bob's edits.
    const forkedListing = await memberBe("node", "list", "--workspace", forked);
    expect(forkedListing).toContain("secret from Alice");
    expect(forkedListing).toContain("secret from Bob");

    // Fresh governance: the forker is the owner, epoch 0. The old roster + epoch did NOT carry over.
    const forkedRoster = await memberBe("member", "list", "--workspace", forked);
    expect(forkedRoster).toContain(`(epoch 0)`);
    expect(forkedRoster).toContain(`${memberActor} (owner)`);
  }, 30000);
});

function parseWorkspaceId(out: string): string {
  const m = /^Created workspace .* \((?<ws>.+)\)\.$/m.exec(out);
  if (!m?.groups?.ws) {
    throw new Error(`parseWorkspaceId failed: ${out}`);
  }
  return m.groups.ws;
}

/** The new wsId from `workspace fork`'s `Forked workspace <src> → <newWsId> (<name>).` line. */
function parseForkedWorkspaceId(out: string): string {
  const m = /^Forked workspace .* → (?<ws>[^\s]+) /m.exec(out);
  if (!m?.groups?.ws) {
    throw new Error(`parseForkedWorkspaceId failed: ${out}`);
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

/** The first non-owner actor line in a `member list` output (`  <actorId>` without `(owner)`). */
function parseNonOwnerActor(out: string): string {
  for (const line of out.split("\n")) {
    if (line.includes("(owner)")) {
      continue;
    }
    const m = /^ {2}(?<actor>[^\s]+)$/.exec(line);
    if (m?.groups?.actor) {
      return m.groups.actor;
    }
  }
  throw new Error(`no non-owner member actor in roster:\n${out}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
