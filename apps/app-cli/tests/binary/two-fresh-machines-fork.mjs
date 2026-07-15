// Fork binary test — the kicked-member recovery flow (design sync-identity-persistence §13). The real
// two-machines topology (a relay + two engine daemons): owner shares, the member joins and both
// write; the owner kicks the member; the kicked member FORKS their retained local copy into a NEW
// workspace where they are the owner, and the fork must carry the full synced content + a fresh
// epoch-0 root. Phase 3: each machine has its own vault + active-actor.
//
// Run: `node tests/binary/two-fresh-machines-fork.mjs` (verbose) or via `npm run test:binary`.

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
  const relayEnv = await spawnRelay();
  relay = relayEnv.child;
  const relayUrl = relayEnv.url;
  tmpA = await mkdtemp(join(tmpdir(), "lode-fork-owner-"));
  tmpB = await mkdtemp(join(tmpdir(), "lode-fork-member-"));
  owner = await spawnDaemon(tmpA);
  member = await spawnDaemon(tmpB);

  const be = (home) => (...args) => runLode(home, args);
  await actorNew(owner.home, PASS, "Alice");
  await actorNew(member.home, PASS, "Bob");
  const ownerBe = be(owner.home);
  const memberBe = be(member.home);

  const memberToken = (await memberBe("identity", "export", "--peer-name", "Bob laptop")).trim();

  // ── owner: workspace + add member + dial relay + write a node + share ──
  const ws = parseWorkspaceCreated(
    await ownerBe("workspace", "create", "--name", "Shared", "--peer-name", "Alice laptop"),
  );
  const ownerRoot = parseRootOcc(await ownerBe("node", "list", "--workspace", ws));
  await ownerBe("member", "add", "--workspace", ws, "--identity", memberToken);
  await ownerBe("sync", "register", "--workspace", ws, "--relay", relayUrl);
  await ownerBe("node", "create", "--workspace", ws, "--parent-occ", ownerRoot, "--text", "secret from Alice");
  const coord = (await ownerBe("sync", "share", "--workspace", ws)).trim();

  // ── member joins, sees Alice's node, writes their own + syncs back (holds BOTH nodes locally). ──
  await memberBe("sync", "join", "--coordinate", coord);
  await sleep(1000);
  const memberRoot = parseRootOcc(await memberBe("node", "list", "--workspace", ws));
  await memberBe("node", "create", "--workspace", ws, "--parent-occ", memberRoot, "--text", "secret from Bob");
  await memberBe("sync", "now", "--workspace", ws);
  await ownerBe("sync", "now", "--workspace", ws);
  await sleep(1000);

  // The member's actorId (a non-owner roster line) — needed for the kick.
  const ownerRoster = await ownerBe("member", "list", "--workspace", ws);
  const memberActorId = (ownerRoster.match(/^  ([a-f0-9]{64})$/m) ?? [])[1];
  if (!memberActorId) throw new Error("could not parse member actorId from owner roster");

  // ── owner kicks the member. Fork is local — copies the member's already-synced replica. ──
  await ownerBe("member", "remove", "--workspace", ws, "--actor-id", memberActorId);

  // ── the kicked member forks their local copy into a fresh workspace where they are the owner ──
  const forkOut = await memberBe("workspace", "fork", "--workspace", ws, "--name", "Recovered");
  const forkedId = (forkOut.match(/→ (\S+) /) ?? [])[1];
  if (!forkedId) throw new Error(`could not parse forked workspace id from: ${forkOut}`);

  const forkedListing = await memberBe("node", "list", "--workspace", forkedId);
  assertContains(forkedListing, "secret from Alice", "forked ws has Alice's node");
  assertContains(forkedListing, "secret from Bob", "forked ws has Bob's node");

  // Fresh governance: the forker is the owner at epoch 0; the old roster + epoch did NOT carry over.
  const forkedRoster = await memberBe("member", "list", "--workspace", forkedId);
  assertContains(forkedRoster, "(epoch 0)", "forked ws starts at epoch 0");
  assertContains(forkedRoster, `${memberActorId} (owner)`, "forker is the owner of the forked ws");

  if (process.argv.includes("--quiet")) {
    console.log("two-fresh-machines-fork binary test: OK");
  }
} finally {
  killAll(relay, owner?.child, member?.child);
  await Promise.all(
    [tmpA, tmpB].map((d) => (d ? rm(d, { recursive: true, force: true }) : undefined)),
  );
}
