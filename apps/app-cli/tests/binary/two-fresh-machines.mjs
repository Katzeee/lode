// Test B — binary sync: the real two-fresh-machines share→join→see flow. Spawns a relay + two engine
// daemons (owner A, member B), drives `lode` against each, and asserts bidirectional convergence.
// Phase 3: each machine has its own vault + active-actor (header auth); `actorNew` initializes it.
//
// Run: `node tests/binary/two-fresh-machines.mjs` (verbose) or via `npm run test:binary` (`--quiet`).

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  spawnRelay,
  spawnDaemon,
  runLode,
  actorNew,
  sleep,
  parseWorkspaceCreated,
  parseRootOcc,
  assertContains,
  killAll,
} from "./_binary-helpers.mjs";

const PASS = "binary-test-passphrase";

let relay;
let owner;
let member;
let tmpA;
let tmpB;

try {
  // ── topology: one relay + two independent daemons (two fresh machines) ──
  const relayEnv = await spawnRelay();
  relay = relayEnv.child;
  const relayUrl = relayEnv.url;
  tmpA = await mkdtemp(join(tmpdir(), "lode-sync-owner-"));
  tmpB = await mkdtemp(join(tmpdir(), "lode-sync-member-"));
  owner = await spawnDaemon(tmpA);
  member = await spawnDaemon(tmpB);

  /** A `lode` runner bound to one machine's home (vault + active-actor). */
  const be = (home) => (...args) => runLode(home, args);

  // ── bootstrap identities on each machine (vault init + active-actor) ──
  await actorNew(owner.home, PASS, "Alice");
  await actorNew(member.home, PASS, "Bob");
  const ownerBe = be(owner.home);
  const memberBe = be(member.home);

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

  // ── A→B: member joins → sees the owner's node (Stage C auto-fires a content round). ──
  await memberBe("sync", "join", "--coordinate", coord);
  await sleep(1000);
  const memberListing = await memberBe("node", "list", "--workspace", ws);
  assertContains(memberListing, "Hello from A", "member node list (A→B)");
  const memberRoot = parseRootOcc(memberListing);

  // ── B→A: member writes + both sides `sync now` → owner sees it ──
  await memberBe("node", "create", "--workspace", ws, "--parent-occ", memberRoot, "--text", "Hello from B");
  await memberBe("sync", "now", "--workspace", ws);
  await ownerBe("sync", "now", "--workspace", ws);
  await sleep(1000);
  assertContains(
    await ownerBe("node", "list", "--workspace", ws),
    "Hello from B",
    "owner node list (B→A)",
  );

  // ── member list: both peers replicated, owner flagged, peer_name shown ──
  const ownerRoster = await ownerBe("member", "list", "--workspace", ws);
  assertContains(ownerRoster, "(owner)", "owner member list flags owner");
  assertContains(ownerRoster, "Alice laptop", "owner member list shows owner peer name");
  assertContains(ownerRoster, "Bob laptop", "owner member list shows member peer name");

  // ── revoke: owner kicks the member by actor (atomic removeAndRotate). ──
  const memberActorId = (ownerRoster.match(/^  ([a-f0-9]{64})$/m) ?? [])[1];
  if (!memberActorId) throw new Error("could not parse member actorId from owner roster");
  await ownerBe("member", "remove", "--workspace", ws, "--actor-id", memberActorId);
  await ownerBe("sync", "now", "--workspace", ws);
  await sleep(1000);
  const ownerRosterAfter = await ownerBe("member", "list", "--workspace", ws);
  assertContains(ownerRosterAfter, "(owner)", "owner still flagged after revoke");
  if (ownerRosterAfter.includes("Bob laptop")) {
    throw new Error("member peer still in owner roster after revoke");
  }

  if (process.argv.includes("--quiet")) {
    console.log("two-fresh-machines binary test: OK");
  }
} finally {
  killAll(relay, owner?.child, member?.child);
  await Promise.all(
    [tmpA, tmpB].map((d) => (d ? rm(d, { recursive: true, force: true }) : undefined)),
  );
}
