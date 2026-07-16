/* eslint-disable max-lines -- 6 daemon sync e2e scenarios sharing one relay + two-daemon harness. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppServerClient, createSocketTransport } from "@lode/client";
import { dialTarget } from "../../src/endpoint.js";
import { BrokerClient, BrokerServer } from "@lode/engine";
import type { AppServerDaemon } from "../../src/app-server-daemon.js";
import { startAppServerDaemon } from "../../src/app-server-daemon.js";
import { openAuthedSession } from "./authed-session.js";

// Secured daemon-level end-to-end sync on the current identity model: the daemon has NO identity —
// every syncing workspace is registered by a session. The OWNER session creates the workspace (which
// roots the membership log with the creator's actor = owner and auto-inits its single content doc),
// registers sync (captures the owner actor + dials the relay), then adds the member + shares a
// WorkspaceCoordinate. The MEMBER session joins via that coordinate → creates the workspace locally
// (its content doc is auto-inited), registers, converges the public membership log over the broker's
// plaintext envelope, derives the transit key, then content syncs SEALED. An eavesdropper on the
// workspace channel cannot read the content.

const WORKSPACE = "ws-secured-e2e";
const daemons: AppServerDaemon[] = [];
const relays: BrokerServer[] = [];
const eavesdroppers: BrokerClient[] = [];
const dataRoots: string[] = [];

afterEach(async () => {
  for (const d of daemons.splice(0)) {
    await d.stop();
  }
  for (const r of relays.splice(0)) {
    await r.close();
  }
  for (const e of eavesdroppers.splice(0)) {
    e.close();
  }
  for (const root of dataRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function tempDataRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "be-sync-secured-"));
  dataRoots.push(root);
  return root;
}

/** Boot an identity-free daemon (the daemon carries no actor; sessions register workspaces). */
async function bootDaemon(
  opts: { dataRoot?: string; syncIntervalMs?: number } = {},
): Promise<AppServerDaemon> {
  const daemon = await startAppServerDaemon({
    listen: "tcp://127.0.0.1:0",
    dataRoot: opts.dataRoot ?? (await tempDataRoot()),
    syncIntervalMs: opts.syncIntervalMs ?? 30,
  });
  daemons.push(daemon);
  return daemon;
}

/** Poll until `client` can read `secret` at `occurrenceId` (the member has converged that content). */
async function expectConverged(
  client: AppServerClient,
  occurrenceId: string,
  secret: string,
  timeoutMs = 20000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const got = await client.rpc.getNode({ workspaceId: WORKSPACE, occurrenceId });
      if (got.occurrence?.deltas?.some((d) => d.insert === secret)) {
        return;
      }
    } catch {
      // not replicated to the member yet — retry next round
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`member did not converge "${secret}" within ${timeoutMs}ms`);
}

describe("daemon sync e2e (secured)", () => {
  it("owner creates + registers + adds + shares; member joins; content converges sealed (opaque to an eavesdropper)", async () => {
    const relay = new BrokerServer({ port: 0 });
    relays.push(relay);
    await relay.ready();
    const syncUrl = `http://127.0.0.1:${relay.port}`;

    const owner = await bootDaemon();
    const member = await bootDaemon();

    const ownerClient = new AppServerClient(createSocketTransport(dialTarget(owner.address)));
    const memberClient = new AppServerClient(createSocketTransport(dialTarget(member.address)));
    ownerClient.connect();
    memberClient.connect();
    await openAuthedSession(ownerClient);
    await openAuthedSession(memberClient);

    // The owner needs the member's PEER tuple (peerId + X25519 enc pub + owning actor) to add them.
    // It comes from the member's OWN session — the peer key is per-dataRoot, read back via
    // GetPeerPublicKeys (the actor is the session's; the peer is the dataRoot's).
    const memberPeer = await memberClient.rpc.getPeerPublicKeys({});

    // Owner creates the workspace — createWorkspace roots the membership log with the owner's session
    // actor (creator = owner). Membership governance is relay-independent: addMember writes the log
    // directly (registry + session keypair, no sync wiring), so it runs BEFORE registerSync — proving
    // the decoupling. registerSync then wires the relay + captures the owner keypair for the tick.
    await ownerClient.rpc.createWorkspace({ workspaceId: WORKSPACE, displayName: "shared" });
    await ownerClient.rpc.addMember({
      workspaceId: WORKSPACE,
      peerEncPub: memberPeer.peerEncPub,
      peerId: memberPeer.peerId,
      owningActorId: memberPeer.owningActorId,
    });
    await ownerClient.rpc.registerSync({ workspaceId: WORKSPACE, relayUrl: syncUrl });

    // Eavesdropper on the SAME workspace channel — the relay routes every publish to all subscribers,
    // so it sees all traffic (sealed content + the plaintext membership roster).
    const wiretap: Uint8Array[] = [];
    const eavesdropper = new BrokerClient({ url: syncUrl, onDeliver: (_ws, p) => wiretap.push(p) });
    eavesdroppers.push(eavesdropper);
    await eavesdropper.open();
    eavesdropper.subscribe(WORKSPACE);

    // Share the coordinate so the member can join.
    const coordinate = await ownerClient.rpc.shareWorkspace({ workspaceId: WORKSPACE });
    expect(coordinate.workspaceId).toBe(WORKSPACE);
    expect(coordinate.relayUrl).toBe(syncUrl);

    // Member joins via the coordinate → creates the workspace locally (content doc auto-inited),
    // registers, and syncs.
    await memberClient.rpc.joinWorkspace({ coordinate });

    // Owner writes a node + text. The member converges membership (plaintext) THEN content (sealed).
    // createWorkspace seeds the single root; attach the secret-bearing content node under it.
    const ownerRoots = await ownerClient.rpc.listRoots({ workspaceId: WORKSPACE });
    const ownerSeededRootOccurrenceId = ownerRoots.roots.at(0)!.occurrenceId;
    const node = await ownerClient.rpc.createPlainNode({
      workspaceId: WORKSPACE,
      parentOccurrenceId: ownerSeededRootOccurrenceId,
    });
    const SECRET = "secured-across-daemons";
    await ownerClient.rpc.replaceNodeText({
      workspaceId: WORKSPACE,
      occurrenceId: node.occurrenceId,
      deltas: [{ insert: SECRET }],
    });
    await expectConverged(memberClient, node.occurrenceId, SECRET);

    eavesdropper.close();
    // Traffic was captured (the relay routed content frames to all subscribers)...
    expect(wiretap.length).toBeGreaterThan(0);
    // ...but the plaintext content NEVER appears (content is transit-key AEAD-sealed; only the public
    // membership roster rides plaintext).
    const secretBytes = new TextEncoder().encode(SECRET);
    expect(wiretap.some((blob) => Buffer.from(blob).includes(Buffer.from(secretBytes)))).toBe(
      false,
    );

    ownerClient.close();
    memberClient.close();
  }, 30000);

  it("refuses a second, different actor re-registering a workspace (ownership guard)", async () => {
    const relay = new BrokerServer({ port: 0 });
    relays.push(relay);
    await relay.ready();
    const syncUrl = `http://127.0.0.1:${relay.port}`;

    const owner = await bootDaemon();
    const ownerClient = new AppServerClient(createSocketTransport(dialTarget(owner.address)));
    ownerClient.connect();
    await openAuthedSession(ownerClient);
    // Owner creates + registers its workspace (the owner's session actor is the registrant).
    await ownerClient.rpc.createWorkspace({ workspaceId: WORKSPACE, displayName: "shared" });
    await ownerClient.rpc.registerSync({ workspaceId: WORKSPACE, relayUrl: syncUrl });

    // A second session on the SAME daemon, a DIFFERENT actor, tries to register the owner's workspace.
    // Without the guard this would overwrite the owner's keypair and brick addMember for the real
    // owner; the guard refuses it.
    const intruderClient = new AppServerClient(createSocketTransport(dialTarget(owner.address)));
    intruderClient.connect();
    await openAuthedSession(intruderClient);
    await expect(
      intruderClient.rpc.registerSync({ workspaceId: WORKSPACE, relayUrl: syncUrl }),
    ).rejects.toThrow(/already registered by actor/);

    // The owner's registration survives the refused intruder — it can still share the workspace.
    const coordinate = await ownerClient.rpc.shareWorkspace({ workspaceId: WORKSPACE });
    expect(coordinate.workspaceId).toBe(WORKSPACE);
    expect(coordinate.relayUrl).toBe(syncUrl);

    ownerClient.close();
    intruderClient.close();
  });

  it("`sync now` drives a round immediately — converges with the periodic tick starved", async () => {
    const relay = new BrokerServer({ port: 0 });
    relays.push(relay);
    await relay.ready();
    const syncUrl = `http://127.0.0.1:${relay.port}`;

    // 60s ticks → the periodic round CANNOT fire during this short test. The ONLY thing that can move
    // content is `syncNow` (`lode sync now`).
    const owner = await bootDaemon({ syncIntervalMs: 60000 });
    const member = await bootDaemon({ syncIntervalMs: 60000 });

    const ownerClient = new AppServerClient(createSocketTransport(dialTarget(owner.address)));
    const memberClient = new AppServerClient(createSocketTransport(dialTarget(member.address)));
    ownerClient.connect();
    memberClient.connect();
    await openAuthedSession(ownerClient);
    await openAuthedSession(memberClient);

    const memberPeer = await memberClient.rpc.getPeerPublicKeys({});

    await ownerClient.rpc.createWorkspace({ workspaceId: WORKSPACE, displayName: "shared" });
    await ownerClient.rpc.registerSync({ workspaceId: WORKSPACE, relayUrl: syncUrl });
    await ownerClient.rpc.addMember({
      workspaceId: WORKSPACE,
      peerEncPub: memberPeer.peerEncPub,
      peerId: memberPeer.peerId,
      owningActorId: memberPeer.owningActorId,
    });
    const coordinate = await ownerClient.rpc.shareWorkspace({ workspaceId: WORKSPACE });
    await memberClient.rpc.joinWorkspace({ coordinate });

    // createWorkspace seeds the single root; attach the secret-bearing content node under it.
    const ownerRoots = await ownerClient.rpc.listRoots({ workspaceId: WORKSPACE });
    const ownerSeededRootOccurrenceId = ownerRoots.roots.at(0)!.occurrenceId;
    const node = await ownerClient.rpc.createPlainNode({
      workspaceId: WORKSPACE,
      parentOccurrenceId: ownerSeededRootOccurrenceId,
    });
    const SECRET = "driven-by-sync-now";
    await ownerClient.rpc.replaceNodeText({
      workspaceId: WORKSPACE,
      occurrenceId: node.occurrenceId,
      deltas: [{ insert: SECRET }],
    });

    // Drive alternating manual rounds until the handshake completes. With the tick starved, only
    // `syncNow` can carry this content across — if it didn't work this loop times out.
    const deadline = Date.now() + 20000;
    let converged = false;
    while (Date.now() < deadline) {
      await ownerClient.rpc.syncNow({ workspaceId: WORKSPACE });
      await memberClient.rpc.syncNow({ workspaceId: WORKSPACE });
      try {
        const got = await memberClient.rpc.getNode({
          workspaceId: WORKSPACE,
          occurrenceId: node.occurrenceId,
        });
        if (got.occurrence?.deltas?.some((d) => d.insert === SECRET)) {
          converged = true;
          break;
        }
      } catch {
        // not replicated yet — another manual round
      }
    }
    expect(converged).toBe(true);

    // Usage guard: triggering a workspace the session never registered is a user error, surfaced.
    await expect(ownerClient.rpc.syncNow({ workspaceId: "never-registered" })).rejects.toThrow(
      /not registered/,
    );

    ownerClient.close();
    memberClient.close();
  }, 30000);

  it("`join` drives a content round immediately — converges with the tick starved (no manual trigger)", async () => {
    const relay = new BrokerServer({ port: 0 });
    relays.push(relay);
    await relay.ready();
    const syncUrl = `http://127.0.0.1:${relay.port}`;

    // 60s ticks → the periodic round CANNOT fire during this short test. The ONLY thing that can move
    // content is the round `joinWorkspace` auto-fires — no manual `syncNow` anywhere.
    const owner = await bootDaemon({ syncIntervalMs: 60000 });
    const member = await bootDaemon({ syncIntervalMs: 60000 });

    const ownerClient = new AppServerClient(createSocketTransport(dialTarget(owner.address)));
    const memberClient = new AppServerClient(createSocketTransport(dialTarget(member.address)));
    ownerClient.connect();
    memberClient.connect();
    await openAuthedSession(ownerClient);
    await openAuthedSession(memberClient);

    const memberPeer = await memberClient.rpc.getPeerPublicKeys({});

    // Owner sets up the workspace AND writes content BEFORE the member joins, so "join → content
    // visible immediately" is exactly the property under test.
    await ownerClient.rpc.createWorkspace({ workspaceId: WORKSPACE, displayName: "shared" });
    await ownerClient.rpc.addMember({
      workspaceId: WORKSPACE,
      peerEncPub: memberPeer.peerEncPub,
      peerId: memberPeer.peerId,
      owningActorId: memberPeer.owningActorId,
    });
    await ownerClient.rpc.registerSync({ workspaceId: WORKSPACE, relayUrl: syncUrl });
    // createWorkspace seeds the single root; attach the secret-bearing content node under it.
    const ownerRoots = await ownerClient.rpc.listRoots({ workspaceId: WORKSPACE });
    const ownerSeededRootOccurrenceId = ownerRoots.roots.at(0)!.occurrenceId;
    const node = await ownerClient.rpc.createPlainNode({
      workspaceId: WORKSPACE,
      parentOccurrenceId: ownerSeededRootOccurrenceId,
    });
    const SECRET = "driven-by-join";
    await ownerClient.rpc.replaceNodeText({
      workspaceId: WORKSPACE,
      occurrenceId: node.occurrenceId,
      deltas: [{ insert: SECRET }],
    });
    const coordinate = await ownerClient.rpc.shareWorkspace({ workspaceId: WORKSPACE });

    // Member joins — the auto-fired content round is the only possible carrier (tick starved, no
    // manual syncNow). If `joinWorkspace` didn't fire it, this polls 20s → the 60s tick never comes
    // → expectConverged throws → test fails.
    await memberClient.rpc.joinWorkspace({ coordinate });
    await expectConverged(memberClient, node.occurrenceId, SECRET);

    ownerClient.close();
    memberClient.close();
  }, 30000);

  it("a local write pushes immediately — converges with the tick starved and NO manual sync on the write", async () => {
    const relay = new BrokerServer({ port: 0 });
    relays.push(relay);
    await relay.ready();
    const syncUrl = `http://127.0.0.1:${relay.port}`;

    // 60s ticks → the periodic round CANNOT fire during this short test. After a single warm-up round
    // (so both sides have each other's profile cached + the member has the target shard materialized),
    // the ONLY thing that can carry the owner's new write is the push fast-path (the runner's
    // committed-fact subscription → debounced `pushOnly`). No post-warm-up `syncNow` anywhere.
    const owner = await bootDaemon({ syncIntervalMs: 60000 });
    const member = await bootDaemon({ syncIntervalMs: 60000 });

    const ownerClient = new AppServerClient(createSocketTransport(dialTarget(owner.address)));
    const memberClient = new AppServerClient(createSocketTransport(dialTarget(member.address)));
    ownerClient.connect();
    memberClient.connect();
    await openAuthedSession(ownerClient);
    await openAuthedSession(memberClient);

    const memberPeer = await memberClient.rpc.getPeerPublicKeys({});

    await ownerClient.rpc.createWorkspace({ workspaceId: WORKSPACE, displayName: "shared" });
    await ownerClient.rpc.addMember({
      workspaceId: WORKSPACE,
      peerEncPub: memberPeer.peerEncPub,
      peerId: memberPeer.peerId,
      owningActorId: memberPeer.owningActorId,
    });
    await ownerClient.rpc.registerSync({ workspaceId: WORKSPACE, relayUrl: syncUrl });
    const coordinate = await ownerClient.rpc.shareWorkspace({ workspaceId: WORKSPACE });

    // Owner writes a node + initial text BEFORE the member joins.
    const ownerRoots = await ownerClient.rpc.listRoots({ workspaceId: WORKSPACE });
    const ownerSeededRootOccurrenceId = ownerRoots.roots.at(0)!.occurrenceId;
    const node = await ownerClient.rpc.createPlainNode({
      workspaceId: WORKSPACE,
      parentOccurrenceId: ownerSeededRootOccurrenceId,
    });
    const BEFORE = "before-warmup";
    await ownerClient.rpc.replaceNodeText({
      workspaceId: WORKSPACE,
      occurrenceId: node.occurrenceId,
      deltas: [{ insert: BEFORE }],
    });

    // Member joins (the join round pulls the owner's current content), then ONE owner round warms the
    // owner's `lastRemoteVV` (the cache pushOnly exports against) — the steady state the 20s tick would
    // reach in production.
    await memberClient.rpc.joinWorkspace({ coordinate });
    await ownerClient.rpc.syncNow({ workspaceId: WORKSPACE });

    // Sanity: the warm-up converged the member (it holds the target shard), so a later push to that
    // shard is meaningful. expectConverged throws if it didn't.
    await expectConverged(memberClient, node.occurrenceId, BEFORE);

    // THE WRITE UNDER TEST — owner updates the existing node's text. With the tick starved and no
    // post-warm-up `syncNow`, only the push fast-path can carry this. If the runner didn't subscribe
    // (or pushOnly is broken), this polls 20s → the 60s tick never comes → expectConverged throws.
    const SECRET = "pushed-on-mutation";
    await ownerClient.rpc.replaceNodeText({
      workspaceId: WORKSPACE,
      occurrenceId: node.occurrenceId,
      deltas: [{ insert: SECRET }],
    });
    await expectConverged(memberClient, node.occurrenceId, SECRET);

    ownerClient.close();
    memberClient.close();
  }, 30000);

  it("synced content persists across a member restart (content-round 落盘 regression)", async () => {
    // The one loop the engine layer can't host (loro wasm coexistence) — here at the daemon layer,
    // in two real processes. The member converges content over sync, then RESTARTS (same dataRoot),
    // and reads it back. `daemon.stop()` is an abrupt `runtime.lifecycle.stop()` (no flush, no clean marker
    // — the engine's `close()` is not on this path), so the synced bytes survive the restart ONLY
    // because the content round flushed them. That `ContentRound.runRound → flushDirty` line was
    // previously verified by reading the code; this is its regression net. A `syncNow` before the
    // stop deterministically closes the exchange→flush window inside the round (same flush code path
    // every round uses, so it can't mask a broken flush — only the timing).
    const relay = new BrokerServer({ port: 0 });
    relays.push(relay);
    await relay.ready();
    const syncUrl = `http://127.0.0.1:${relay.port}`;
    // MEMBER's dataRoot is reused across the restart — the persistence contract under test.
    const memberDataRoot = await tempDataRoot();

    const owner = await bootDaemon();
    const member = await bootDaemon({ dataRoot: memberDataRoot });

    const ownerClient = new AppServerClient(createSocketTransport(dialTarget(owner.address)));
    const memberClient = new AppServerClient(createSocketTransport(dialTarget(member.address)));
    ownerClient.connect();
    memberClient.connect();
    await openAuthedSession(ownerClient);
    await openAuthedSession(memberClient);

    const memberPeer = await memberClient.rpc.getPeerPublicKeys({});
    await ownerClient.rpc.createWorkspace({ workspaceId: WORKSPACE, displayName: "shared" });
    await ownerClient.rpc.addMember({
      workspaceId: WORKSPACE,
      peerEncPub: memberPeer.peerEncPub,
      peerId: memberPeer.peerId,
      owningActorId: memberPeer.owningActorId,
    });
    await ownerClient.rpc.registerSync({ workspaceId: WORKSPACE, relayUrl: syncUrl });
    const coordinate = await ownerClient.rpc.shareWorkspace({ workspaceId: WORKSPACE });
    await memberClient.rpc.joinWorkspace({ coordinate });

    const ownerRoots = await ownerClient.rpc.listRoots({ workspaceId: WORKSPACE });
    const ownerSeededRootOccurrenceId = ownerRoots.roots.at(0)!.occurrenceId;
    const node = await ownerClient.rpc.createPlainNode({
      workspaceId: WORKSPACE,
      parentOccurrenceId: ownerSeededRootOccurrenceId,
    });
    const SECRET = "survives-member-restart";
    await ownerClient.rpc.replaceNodeText({
      workspaceId: WORKSPACE,
      occurrenceId: node.occurrenceId,
      deltas: [{ insert: SECRET }],
    });
    await expectConverged(memberClient, node.occurrenceId, SECRET);
    // Force a complete round so the imported content is flushed before the abrupt stop.
    await memberClient.rpc.syncNow({ workspaceId: WORKSPACE });

    // Abrupt restart on the SAME dataRoot. stop() does not flush — the content round did.
    memberClient.close();
    await member.stop();
    daemons.splice(daemons.indexOf(member), 1); // already stopped; don't let afterEach double-stop it

    const member2 = await bootDaemon({ dataRoot: memberDataRoot });
    const memberClient2 = new AppServerClient(createSocketTransport(dialTarget(member2.address)));
    memberClient2.connect();
    await openAuthedSession(memberClient2);
    try {
      const restored = await memberClient2.rpc.getNode({
        workspaceId: WORKSPACE,
        occurrenceId: node.occurrenceId,
      });
      expect(restored.occurrence?.deltas?.some((d) => d.insert === SECRET)).toBe(true);
    } finally {
      ownerClient.close();
      memberClient2.close();
    }
  }, 30000);
});
