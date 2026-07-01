import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppServerClient } from "@lode/client";
import { BrokerClient, BrokerServer } from "@lode/transport";
import { deriveActorKeypairFromMnemonic, generateMnemonic } from "@lode/engine";
import type { AppServerDaemon } from "../../src/app-server-daemon.js";
import { startAppServerDaemon } from "../../src/app-server-daemon.js";
import { openAuthedSession } from "./authed-session.js";

// Secured daemon-level end-to-end sync over the real Phase-4 flow: the OWNER pre-configures its
// workspace (dials the relay + bootstraps the membership root), adds a member via the AddMember RPC,
// and shares a WorkspaceCoordinate; the MEMBER starts with just a mnemonic and JoinWorkspaces via
// that coordinate → it creates the workspace + doc locally, converges the public membership log over
// the broker's plaintext envelope, derives the transit key, then content syncs SEALED. An
// eavesdropper on the workspace channel cannot read the content.

const WORKSPACE = "ws-secured-e2e";
const DOC = "main";
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

/** Boot a daemon. The owner passes `url` + `workspaceIds` (it bootstraps the membership root for
 *  those); a member passes neither (it joins at runtime via JoinWorkspace). `dataRoot` is reused
 *  across boots so a restart reopens the persisted membership log + content. */
async function bootDaemon(opts: {
  mnemonic: string;
  url?: string;
  workspaceIds?: string[];
  dataRoot?: string;
}): Promise<AppServerDaemon> {
  const daemon = await startAppServerDaemon({
    listen: "tcp://127.0.0.1:0",
    dataRoot: opts.dataRoot ?? (await tempDataRoot()),
    sync: {
      actorMnemonic: opts.mnemonic,
      intervalMs: 30,
      ...(opts.url === undefined ? {} : { url: opts.url }),
      ...(opts.workspaceIds === undefined ? {} : { workspaceIds: opts.workspaceIds }),
    },
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

describe("daemon sync e2e (secured, Phase-4 flow)", () => {
  it("owner adds + shares; member joins via coordinate; content converges sealed (opaque to an eavesdropper)", async () => {
    const relay = new BrokerServer({ port: 0 });
    relays.push(relay);
    await relay.ready();
    const syncUrl = `ws://127.0.0.1:${relay.port}`;

    const ownerMnemonic = generateMnemonic();
    const memberMnemonic = generateMnemonic();
    // The owner must know the member's sign pub to add them (the social re-add). Derived
    // deterministically from the member's mnemonic.
    const memberSignPub = deriveActorKeypairFromMnemonic(memberMnemonic).publicKey;

    const owner = await bootDaemon({
      mnemonic: ownerMnemonic,
      url: syncUrl,
      workspaceIds: [WORKSPACE],
    });
    const member = await bootDaemon({ mnemonic: memberMnemonic });

    const ownerClient = new AppServerClient({ url: owner.address });
    const memberClient = new AppServerClient({ url: member.address });
    ownerClient.connect();
    memberClient.connect();
    await openAuthedSession(ownerClient);
    await openAuthedSession(memberClient);

    // Owner creates the workspace + doc → its runner materializes + bootstraps the membership root.
    await ownerClient.rpc.createWorkspace({ workspaceId: WORKSPACE, displayName: "shared" });
    await ownerClient.rpc.createWorkspaceDoc({
      workspaceId: WORKSPACE,
      docId: DOC,
      displayName: "Main",
    });

    // Eavesdropper on the SAME workspace channel — the relay routes every publish to all subscribers,
    // so it sees all traffic (sealed content + the plaintext membership roster).
    const wiretap: Uint8Array[] = [];
    const eavesdropper = new BrokerClient({ url: syncUrl, onDeliver: (_ws, p) => wiretap.push(p) });
    eavesdroppers.push(eavesdropper);
    await eavesdropper.open();
    eavesdropper.subscribe(WORKSPACE);

    // Owner governance: add the member, then share the coordinate.
    await ownerClient.rpc.addMember({ workspaceId: WORKSPACE, memberSignPub });
    const coordinate = await ownerClient.rpc.shareWorkspace({ workspaceId: WORKSPACE });
    expect(coordinate.workspaceId).toBe(WORKSPACE);
    expect(coordinate.docId).toBe(DOC);
    expect(coordinate.relayUrl).toBe(syncUrl);

    // Member joins via the coordinate → creates the workspace + doc locally, dials, syncs.
    await memberClient.rpc.joinWorkspace({ coordinate });

    // Owner writes a node + text. The member converges membership (plaintext) THEN content (sealed).
    const node = await ownerClient.rpc.createPlainNode({ workspaceId: WORKSPACE });
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

  it("membership log survives a full daemon restart: content re-syncs sealed (no re-bootstrap)", async () => {
    const relay = new BrokerServer({ port: 0 });
    relays.push(relay);
    await relay.ready();
    const syncUrl = `ws://127.0.0.1:${relay.port}`;

    const ownerMnemonic = generateMnemonic();
    const memberMnemonic = generateMnemonic();
    const memberSignPub = deriveActorKeypairFromMnemonic(memberMnemonic).publicKey;
    // Stable per-actor data roots so the second boot reuses the persisted membership log + content.
    const ownerRoot = await tempDataRoot();
    const memberRoot = await tempDataRoot();

    // Run 1 — full flow: owner bootstraps + adds + shares; member joins; SECRET1 syncs sealed.
    const o1 = await bootDaemon({
      mnemonic: ownerMnemonic,
      url: syncUrl,
      workspaceIds: [WORKSPACE],
      dataRoot: ownerRoot,
    });
    const m1 = await bootDaemon({ mnemonic: memberMnemonic, dataRoot: memberRoot });
    const cA1 = new AppServerClient({ url: o1.address });
    const cB1 = new AppServerClient({ url: m1.address });
    cA1.connect();
    cB1.connect();
    await openAuthedSession(cA1);
    await openAuthedSession(cB1);
    await cA1.rpc.createWorkspace({ workspaceId: WORKSPACE, displayName: "shared" });
    await cA1.rpc.createWorkspaceDoc({ workspaceId: WORKSPACE, docId: DOC, displayName: "Main" });
    await cA1.rpc.addMember({ workspaceId: WORKSPACE, memberSignPub });
    const coordinate = await cA1.rpc.shareWorkspace({ workspaceId: WORKSPACE });
    await cB1.rpc.joinWorkspace({ coordinate });
    const n1 = await cA1.rpc.createPlainNode({ workspaceId: WORKSPACE });
    const SECRET1 = "before-restart";
    await cA1.rpc.replaceNodeText({
      workspaceId: WORKSPACE,
      occurrenceId: n1.occurrenceId,
      deltas: [{ insert: SECRET1 }],
    });
    await expectConverged(cB1, n1.occurrenceId, SECRET1);
    cA1.close();
    cB1.close();
    await o1.stop();
    await m1.stop();

    // Run 2 — SAME dataRoots + mnemonics. The owner reloads the persisted membership (records > 0 →
    // no re-bootstrap); the member re-joins its persisted workspace. Newly written content syncs
    // sealed under the SAME transit key. (The load-before-bootstrap gate + the snapshot round-trip
    // are proven directly in engine membership-log.persist.test.ts.)
    const o2 = await bootDaemon({
      mnemonic: ownerMnemonic,
      url: syncUrl,
      workspaceIds: [WORKSPACE],
      dataRoot: ownerRoot,
    });
    const m2 = await bootDaemon({ mnemonic: memberMnemonic, dataRoot: memberRoot });
    const cA2 = new AppServerClient({ url: o2.address });
    const cB2 = new AppServerClient({ url: m2.address });
    cA2.connect();
    cB2.connect();
    await openAuthedSession(cA2);
    await openAuthedSession(cB2);
    // The workspace + doc already persist on the owner; re-share + re-join (the member's runner
    // forgets its joined set on restart — re-join re-opens its persisted workspace).
    const coordinate2 = await cA2.rpc.shareWorkspace({ workspaceId: WORKSPACE });
    await cB2.rpc.joinWorkspace({ coordinate: coordinate2 });
    const n2 = await cA2.rpc.createPlainNode({ workspaceId: WORKSPACE });
    const SECRET2 = "after-restart";
    await cA2.rpc.replaceNodeText({
      workspaceId: WORKSPACE,
      occurrenceId: n2.occurrenceId,
      deltas: [{ insert: SECRET2 }],
    });
    await expectConverged(cB2, n2.occurrenceId, SECRET2); // new content syncs sealed post-restart
    await expectConverged(cB2, n1.occurrenceId, SECRET1); // pre-restart content is still readable
    cA2.close();
    cB2.close();
  }, 60000);
});
