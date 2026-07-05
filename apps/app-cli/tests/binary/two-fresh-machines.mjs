// Test B — binary sync: the real two-fresh-machines share→join→see flow. Spawns a relay + two engine
// daemons (owner A, member B), drives `lode` against each, and asserts bidirectional convergence:
//   • A→B (Stage C fast-path): member joins, sees the owner's node via `node list` — no manual sync.
//   • B→A (writes don't auto-push): member writes + both `sync now`, owner sees the member's node.
//
// Run: `node tests/binary/two-fresh-machines.mjs` (verbose) or via `npm run test:binary` (`--quiet`).

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  spawnRelay,
  spawnDaemon,
  runLode,
  sleep,
  parseActorNew,
  parseWorkspaceCreated,
  parseRootOcc,
  assertContains,
  killAll,
} from "./_binary-helpers.mjs";

let relay;
let relayUrl;
let owner;
let ownerUrl;
let member;
let memberUrl;
let tmpA;
let tmpB;

try {
  // ── topology: one relay + two independent daemons (two fresh machines) ──
  ({ child: relay, url: relayUrl } = await spawnRelay());
  tmpA = await mkdtemp(join(tmpdir(), "lode-sync-owner-"));
  tmpB = await mkdtemp(join(tmpdir(), "lode-sync-member-"));
  ({ child: owner, url: ownerUrl } = await spawnDaemon(tmpA));
  ({ child: member, url: memberUrl } = await spawnDaemon(tmpB));

  /** A `lode` runner bound to one daemon's url + the session's mnemonic. */
  const be = (url, mnemonic) => (...args) => runLode(url, mnemonic, args);

  // ── bootstrap identities on each machine ──
  const ownerMnemonic = parseActorNew(await runLode(ownerUrl, undefined, ["actor", "new"])).mnemonic;
  const memberMnemonic = parseActorNew(await runLode(memberUrl, undefined, ["actor", "new"])).mnemonic;
  const ownerBe = be(ownerUrl, ownerMnemonic);
  const memberBe = be(memberUrl, memberMnemonic);

  // member exports their identity as one opaque token → owner (out-of-band).
  const memberToken = (await memberBe("identity", "export", "--peer-name", "Bob laptop")).trim();

  // ── owner: workspace (system-generated id) + its seeded root ──
  const ws = parseWorkspaceCreated(
    await ownerBe("workspace", "create", "--name", "Shared", "--peer-name", "Alice laptop"),
  );
  const ownerRoot = parseRootOcc(await ownerBe("node", "list", "--workspace", ws));

  // ── owner: add member from the token, dial the relay, write a node, share the coordinate ──
  await ownerBe("member", "add", "--workspace", ws, "--identity", memberToken);
  await ownerBe("sync", "register", "--workspace", ws, "--relay", relayUrl);
  await ownerBe("node", "create", "--workspace", ws, "--parent-occ", ownerRoot, "--text", "Hello from A");
  const coord = (await ownerBe("sync", "share", "--workspace", ws)).trim();

  // ── A→B: member joins → sees the owner's node (Stage C auto-fires a content round). Sync isn't
  //    instantaneous (the join's round is fire-and-forget), so wait for it to land before reading. ──
  await memberBe("sync", "join", "--coordinate", coord);
  await sleep(1000);
  const memberListing = await memberBe("node", "list", "--workspace", ws);
  assertContains(memberListing, "Hello from A", "member node list (A→B)");
  const memberRoot = parseRootOcc(memberListing);

  // ── B→A: member writes + both sides `sync now` (writes don't auto-push — T3 deferred) → owner sees it ──
  await memberBe("node", "create", "--workspace", ws, "--parent-occ", memberRoot, "--text", "Hello from B");
  await memberBe("sync", "now", "--workspace", ws); // member pushes
  await ownerBe("sync", "now", "--workspace", ws); // owner pulls
  await sleep(1000);
  const ownerListing = await ownerBe("node", "list", "--workspace", ws);
  assertContains(ownerListing, "Hello from B", "owner node list (B→A)");

  // ── member list: both peers replicated, owner flagged, peer_name shown ──
  const ownerRoster = await ownerBe("member", "list", "--workspace", ws);
  assertContains(ownerRoster, "(owner)", "owner member list flags owner");
  assertContains(ownerRoster, "Alice laptop", "owner member list shows owner peer name");
  assertContains(ownerRoster, "Bob laptop", "owner member list shows member peer name");
  const memberRoster = await memberBe("member", "list", "--workspace", ws);
  assertContains(memberRoster, "Bob laptop", "member member list shows own peer name (roster replicated)");

  if (process.argv.includes("--quiet")) {
    console.log("two-fresh-machines binary test: OK");
  }
} finally {
  killAll(relay, owner, member);
  await Promise.all(
    [tmpA, tmpB].map((d) => (d ? rm(d, { recursive: true, force: true }) : undefined)),
  );
}
