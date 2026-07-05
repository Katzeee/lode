// Fork binary test — the Phase 3 recovery flow (design sync-identity-persistence §13). The real
// two-machines topology (a relay + two engine daemons): owner shares a workspace, the member joins
// and both write; the owner kicks the member; the kicked member FORKS their retained local copy
// into a NEW workspace where they are the owner, and the fork must carry the full synced content +
// a fresh epoch-0 root. Local-first: data already replicated cannot be recalled, so a kicked peer
// keeps their copy and forks away.
//
// Run: `node tests/binary/two-fresh-machines-fork.mjs` (verbose) or via `npm run test:binary`.

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
  tmpA = await mkdtemp(join(tmpdir(), "lode-fork-owner-"));
  tmpB = await mkdtemp(join(tmpdir(), "lode-fork-member-"));
  ({ child: owner, url: ownerUrl } = await spawnDaemon(tmpA));
  ({ child: member, url: memberUrl } = await spawnDaemon(tmpB));

  const be = (url, mnemonic) => (...args) => runLode(url, mnemonic, args);

  // ── bootstrap identities on each machine ──
  const ownerMnemonic = parseActorNew(await runLode(ownerUrl, undefined, ["actor", "new"])).mnemonic;
  const memberMnemonic = parseActorNew(await runLode(memberUrl, undefined, ["actor", "new"])).mnemonic;
  const ownerBe = be(ownerUrl, ownerMnemonic);
  const memberBe = be(memberUrl, memberMnemonic);

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

  // ── member joins, sees Alice's node, then writes their own + syncs back. After this the member
  //    holds BOTH nodes locally — the body of content the fork must carry. ──
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

  // ── owner kicks the member. The member does NOT need to receive the revoke — fork is local:
  //    it copies the member's already-synced replica (local-first: replicated data is kept). ──
  await ownerBe("member", "remove", "--workspace", ws, "--actor", memberActorId);

  // ── the kicked member forks their local copy into a fresh workspace where they are the owner ──
  const forkOut = await memberBe("workspace", "fork", "--workspace", ws, "--name", "Recovered");
  const forkedId = (forkOut.match(/→ (\S+) /) ?? [])[1];
  if (!forkedId) throw new Error(`could not parse forked workspace id from: ${forkOut}`);

  // The fork carries the full synced content — both Alice's and Bob's edits.
  const forkedListing = await memberBe("node", "list", "--workspace", forkedId);
  assertContains(forkedListing, "secret from Alice", "forked ws has Alice's node");
  assertContains(forkedListing, "secret from Bob", "forked ws has Bob's node");

  // Fresh governance: the forker is the owner at epoch 0. The old roster + epoch did NOT carry over.
  const forkedRoster = await memberBe("member", "list", "--workspace", forkedId);
  assertContains(forkedRoster, "(epoch 0)", "forked ws starts at epoch 0");
  assertContains(forkedRoster, `${memberActorId} (owner)`, "forker is the owner of the forked ws");

  if (process.argv.includes("--quiet")) {
    console.log("two-fresh-machines-fork binary test: OK");
  }
} finally {
  killAll(relay, owner, member);
  await Promise.all(
    [tmpA, tmpB].map((d) => (d ? rm(d, { recursive: true, force: true }) : undefined)),
  );
}
