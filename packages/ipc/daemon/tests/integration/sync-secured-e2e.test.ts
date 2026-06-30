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

// Secured daemon-level end-to-end sync. Two real AppServer daemons (each its own dataRoot →
// distinct stable peerId), each with a mnemonic-derived actor keypair, + a workspace-routing relay.
// The owner bootstraps the membership log (root + `add` member); the member converges that PUBLIC log
// over the broker's plaintext envelope, derives the transit key, then content syncs SEALED. An
// eavesdropper on the workspace cannot read the content.

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

/** Boot a daemon that dials `syncUrl`. With `mnemonic` it runs the SECURED path; `bootstrapMembers`
 *  (owner only) seeds the membership root + adds. */
async function bootSecuredDaemon(
  syncUrl: string,
  opts: { mnemonic: string; bootstrapMembers?: Uint8Array[] },
): Promise<AppServerDaemon> {
  const daemon = await startAppServerDaemon({
    listen: "tcp://127.0.0.1:0",
    dataRoot: await tempDataRoot(),
    sync: {
      url: syncUrl,
      workspaceIds: [WORKSPACE],
      intervalMs: 30,
      actorMnemonic: opts.mnemonic,
      ...(opts.bootstrapMembers === undefined ? {} : { bootstrapMembers: opts.bootstrapMembers }),
    },
  });
  daemons.push(daemon);
  return daemon;
}

describe("daemon sync e2e (secured)", () => {
  it("owner + member converge a workspace over a relay; content is opaque to an eavesdropper", async () => {
    const relay = new BrokerServer({ port: 0 });
    relays.push(relay);
    await relay.ready();
    const syncUrl = `ws://127.0.0.1:${relay.port}`;

    const ownerMnemonic = generateMnemonic();
    const memberMnemonic = generateMnemonic();
    // The owner must know the member's sign pub to `add` them (the social re-add). Derived
    // deterministically from the member's mnemonic.
    const memberSignPub = deriveActorKeypairFromMnemonic(memberMnemonic).publicKey;

    const [a, b] = await Promise.all([
      bootSecuredDaemon(syncUrl, { mnemonic: ownerMnemonic, bootstrapMembers: [memberSignPub] }),
      bootSecuredDaemon(syncUrl, { mnemonic: memberMnemonic }),
    ]);

    // An eavesdropper on the SAME workspace channel — the relay routes every publish to all
    // subscribers, so it sees all traffic (sealed content + the plaintext membership roster).
    const wiretap: Uint8Array[] = [];
    const eavesdropper = new BrokerClient({ url: syncUrl, onDeliver: (_ws, p) => wiretap.push(p) });
    eavesdroppers.push(eavesdropper);
    await eavesdropper.open();
    eavesdropper.subscribe(WORKSPACE);

    const clientA = new AppServerClient({ url: a.address });
    const clientB = new AppServerClient({ url: b.address });
    clientA.connect();
    clientB.connect();
    await openAuthedSession(clientA);
    await openAuthedSession(clientB);

    // Both open the same workspace + treeDoc. This also triggers each runner's lazy materialize
    // (the workspace doesn't exist at boot) → the owner bootstraps the membership log on first load.
    for (const client of [clientA, clientB]) {
      await client.rpc.createWorkspace({ workspaceId: WORKSPACE, displayName: "shared" });
      await client.rpc.createWorkspaceDoc({
        workspaceId: WORKSPACE,
        docId: "main",
        displayName: "Main",
      });
    }

    // A writes a node + text. The member must converge membership (plaintext) THEN content (sealed).
    const node = await clientA.rpc.createPlainNode({ workspaceId: WORKSPACE });
    const SECRET = "secured-across-daemons";
    await clientA.rpc.replaceNodeText({
      workspaceId: WORKSPACE,
      occurrenceId: node.occurrenceId,
      deltas: [{ insert: SECRET }],
    });

    const deadline = Date.now() + 15000;
    let converged = false;
    while (Date.now() < deadline) {
      try {
        const got = await clientB.rpc.getNode({
          workspaceId: WORKSPACE,
          occurrenceId: node.occurrenceId,
        });
        if (got.occurrence?.deltas?.some((d) => d.insert === SECRET)) {
          converged = true;
          break;
        }
      } catch {
        // not replicated to B yet — retry next round
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(converged).toBe(true);

    eavesdropper.close();

    // Traffic was captured (the relay routed content frames to all subscribers)...
    expect(wiretap.length).toBeGreaterThan(0);
    // ...but the plaintext content NEVER appears (content is transit-key AEAD-sealed; only the public
    // membership roster rides plaintext).
    const secretBytes = new TextEncoder().encode(SECRET);
    expect(wiretap.some((blob) => Buffer.from(blob).includes(Buffer.from(secretBytes)))).toBe(
      false,
    );

    clientA.close();
    clientB.close();
  }, 20000);
});
