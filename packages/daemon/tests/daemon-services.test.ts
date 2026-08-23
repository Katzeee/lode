import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDesktopClient } from "@lode/desktop-client";
import { createEngine, NodePersistenceBackend } from "@lode/engine/host";
import { Code } from "@connectrpc/connect";
import { afterEach, describe, expect, it } from "vitest";

import { startDaemon } from "../src/daemon.js";
import { defaultExchangeEndpoint } from "../src/daemon.js";
import { DesktopPeerTransport } from "../src/peer-exchange-transport.js";
import {
  createGovernedWorkspace,
  homeOf,
  joinHomeToWorkspace,
  TEST_PASSPHRASE,
  type GovernedHome,
} from "./governed-homes.js";

const accessToken = "lode-test-transport-access-token";
const temporaryDirectories: string[] = [];

async function startTestDaemon(options: Readonly<{ listen: string; dataRoot: string; accessToken: string }>) {
  const peerTransport = new DesktopPeerTransport(defaultExchangeEndpoint(options.listen));
  const engine = createEngine({ persistence: new NodePersistenceBackend(options.dataRoot), peerTransport });
  await engine.start();
  const daemon = await startDaemon({
    engine,
    listen: options.listen,
    exchangeAddress: peerTransport.address,
    accessToken,
    status: { homeName: "test", daemonVersion: "test", homePath: options.dataRoot },
  });
  return daemon;
}

async function startHome(
  label: string,
): Promise<Readonly<{ home: GovernedHome; stop(): Promise<void>; dataRoot: string }>> {
  const dataRoot = await mkdtemp(join(tmpdir(), `lode-${label}-`));
  temporaryDirectories.push(dataRoot);
  const daemon = await startTestDaemon({ listen: "tcp://127.0.0.1:0", dataRoot, accessToken });
  const home = homeOf(daemon, accessToken);
  return { home, dataRoot, stop: () => daemon.stop() };
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("generated daemon service adapters", () => {
  it("preserves completion, retry and read-your-write semantics", async () => {
    const { home, stop } = await startHome("ipc-contract");
    const { client } = home;
    const unauthenticated = createDesktopClient(home.controlEndpoint, "wrong-token");
    try {
      await expect(unauthenticated.listWorkspaces()).rejects.toMatchObject({
        code: Code.Unauthenticated,
      });
      const ownerActorId = await createGovernedWorkspace(home, "workspace", "Workspace");
      const command = {
        kind: "edit",
        workspaceId: "workspace",
        invocationId: "ipc-create",
        actorId: ownerActorId,
        intent: "direct",
        historyChannelId: "desktop",
        actions: [
          nodeAt("node", "workspace", "node-original"),
          { ...nodeAt("tag", "workspace", "tag-original"), intrinsicNodeType: "supertag-definition" as const },
          {
            kind: "supertag-application-create",
            hostNodeId: "node",
            supertagId: "tag",
            anchor: { after: null, before: null, affinity: "after", fallback: "end" },
          },
        ],
      } as const;
      const first = await client.execute(command);
      expect(first.status).toBe("published");
      expect(await client.execute(command)).toEqual(first);
      expect(
        await client.query({
          kind: "projection",
          workspaceId: "workspace",
          perspective: "origin",
        }),
      ).toMatchObject({ status: "ok", value: { nodes: { node: { nodeId: "node" } } } });
      expect(
        await client.query({
          kind: "projection",
          workspaceId: "workspace",
          perspective: "origin",
          section: "supertagApplications",
        }),
      ).toMatchObject({
        status: "ok",
        value: {
          supertagApplications: {
            node: [{ hostNodeId: "node", supertagId: "tag" }],
          },
        },
      });

      expect(
        await client.execute({
          ...command,
          invocationId: "invalid-ipc",
          actions: [{ kind: "future-action", extra: true }],
        } as never),
      ).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });
      expect(
        await client.query({
          kind: "projection",
          workspaceId: "unknown-workspace",
          perspective: "origin",
        }),
      ).toMatchObject({ status: "rejected", error: { code: "workspace-not-found" } });
    } finally {
      unauthenticated.close();
      client.close();
      await stop();
    }
  });

  it("lists and creates Workspaces through the authenticated host capability", async () => {
    const { home, stop } = await startHome("ipc-workspaces");
    const { client } = home;
    try {
      expect(await client.listWorkspaces()).toEqual([]);
      await client.createActor({ label: "Personal Owner", passphrase: TEST_PASSPHRASE });
      const actor = (await client.listActors()).actors[0];
      expect(actor?.unlocked).toBe(true);
      await client.createWorkspace("personal", "Personal", actor?.actorId ?? "");
      expect(await client.listWorkspaces()).toEqual([{ workspaceId: "personal", label: "Personal" }]);
      await expect(client.createWorkspace("personal", "Other", actor?.actorId ?? "")).rejects.toThrow("already exists");
      // A same-id create with a matching label stays idempotent at the catalog.
      await expect(
        client.execute({
          kind: "edit",
          workspaceId: "uncataloged",
          invocationId: "ipc-unknown",
          actorId: actor?.actorId ?? "",
          intent: "direct",
          historyChannelId: "desktop",
          actions: [nodeAt("node", "uncataloged", "occurrence")],
        }),
      ).resolves.toMatchObject({ status: "rejected", error: { code: "workspace-not-found" } });
      await expect(client.syncWorkspace("uncataloged", home.exchangeEndpoint)).rejects.toMatchObject({
        code: Code.NotFound,
      });
    } finally {
      client.close();
      await stop();
    }
  });

  it("keeps a governed workspace's writes attributed and member-gated", async () => {
    const { home, stop } = await startHome("governed-writes");
    const { client } = home;
    try {
      const owner = await createGovernedWorkspace(home, "workspace", "Workspace");
      const second = await client.createActor({ label: "Second", passphrase: TEST_PASSPHRASE });
      // The second Actor exists and is unlocked but is not a member yet.
      const nonMember = await client.execute({
        kind: "edit",
        workspaceId: "workspace",
        invocationId: "non-member",
        actorId: second.actorId,
        intent: "direct",
        historyChannelId: "desktop",
        actions: [nodeAt("outsider", "workspace", "outsider-occurrence")],
      });
      expect(nonMember).toMatchObject({ status: "rejected", error: { code: "actor-not-member" } });

      await client.admitActor({ workspaceId: "workspace", actingActorId: owner, actorId: second.actorId });
      const third = await client.createActor({ label: "Third", passphrase: TEST_PASSPHRASE });
      await expect(
        client.admitActor({
          workspaceId: "workspace",
          actingActorId: second.actorId,
          actorId: third.actorId,
        }),
      ).rejects.toMatchObject({ code: Code.PermissionDenied });
      const written = await client.execute({
        kind: "edit",
        workspaceId: "workspace",
        invocationId: "member-write",
        actorId: second.actorId,
        intent: "direct",
        historyChannelId: "desktop",
        actions: [nodeAt("second-node", "workspace", "second-node-occurrence")],
      });
      expect(written.status).toBe("published");

      // Locking the vault stops new signature-bearing writes only.
      await client.lockVault();
      const locked = await client.execute({
        kind: "edit",
        workspaceId: "workspace",
        invocationId: "locked-write",
        actorId: second.actorId,
        intent: "direct",
        historyChannelId: "desktop",
        actions: [nodeAt("locked-node", "workspace", "locked-node-occurrence")],
      });
      expect(locked).toMatchObject({ status: "rejected", error: { code: "actor-locked" } });
      expect(
        (
          await client.query({
            kind: "projection",
            workspaceId: "workspace",
            perspective: "origin",
            section: "nodes",
          })
        ).status,
      ).toBe("ok");
    } finally {
      client.close();
      await stop();
    }
  });

  it("runs the admission and adoption product flow across two homes and converges", async () => {
    const memberHome = await startHome("sync-member");
    const joinerHome = await startHome("sync-joiner");
    const member = memberHome.home;
    const joiner = joinerHome.home;
    try {
      const owner = await createGovernedWorkspace(member, "workspace", "Workspace");
      await member.client.execute({
        kind: "edit",
        workspaceId: "workspace",
        invocationId: "member-node",
        actorId: owner,
        intent: "direct",
        historyChannelId: "desktop",
        actions: [nodeAt("from-member", "workspace", "from-member-original")],
      });
      const { joinerActorId } = await joinHomeToWorkspace({ home: member, actingActorId: owner }, joiner, "workspace");

      // The joiner adopts the full journal and can then write as its own Actor.
      const joinerWrite = await joiner.client.execute({
        kind: "edit",
        workspaceId: "workspace",
        invocationId: "joiner-node",
        actorId: joinerActorId,
        intent: "direct",
        historyChannelId: "desktop",
        actions: [nodeAt("from-joiner", "workspace", "from-joiner-original")],
      });
      expect(joinerWrite.status).toBe("published");
      expect(
        await joiner.client.query({
          kind: "projection",
          workspaceId: "workspace",
          perspective: "origin",
          section: "nodes",
        }),
      ).toMatchObject({ status: "ok", value: { nodes: { "from-member": { nodeId: "from-member" } } } });

      const exchanged = await member.client.syncWorkspace("workspace", joiner.exchangeEndpoint);
      expect(exchanged.pulled).toBeGreaterThan(0);
      expect(
        await member.client.query({
          kind: "projection",
          workspaceId: "workspace",
          perspective: "origin",
          section: "nodes",
        }),
      ).toMatchObject({ status: "ok", value: { nodes: { "from-joiner": { nodeId: "from-joiner" } } } });

      const summary = await member.client.governanceSummary("workspace");
      expect(summary.memberActorIds).toEqual(expect.arrayContaining([owner, joinerActorId]));
      expect(summary.peers.map((peer) => peer.peerId)).toHaveLength(2);
    } finally {
      member.client.close();
      joiner.client.close();
      await Promise.all([memberHome.stop(), joinerHome.stop()]);
    }
  });

  it("keeps replica exchange working with the Actor Vault locked", async () => {
    const memberHome = await startHome("locked-member");
    const joinerHome = await startHome("locked-joiner");
    const member = memberHome.home;
    const joiner = joinerHome.home;
    try {
      const owner = await createGovernedWorkspace(member, "workspace", "Workspace");
      await joinHomeToWorkspace({ home: member, actingActorId: owner }, joiner, "workspace");
      await joiner.client.execute({
        kind: "edit",
        workspaceId: "workspace",
        invocationId: "joiner-node",
        actorId: (await joiner.client.listActors()).actors.find((actor) => actor.label === "Joiner")?.actorId ?? "",
        intent: "direct",
        historyChannelId: "desktop",
        actions: [nodeAt("locked-vault-node", "workspace", "locked-vault-node-occurrence")],
      });

      // Locking stops signature-bearing writes only; the exchange runs on Peer
      // admission and the transit key, never on an Actor key.
      await member.client.lockVault();
      await joiner.client.lockVault();
      const exchanged = await member.client.syncWorkspace("workspace", joiner.exchangeEndpoint);
      expect(exchanged.pulled).toBeGreaterThan(0);
      expect(
        await member.client.query({
          kind: "projection",
          workspaceId: "workspace",
          perspective: "origin",
          section: "nodes",
        }),
      ).toMatchObject({ status: "ok", value: { nodes: { "locked-vault-node": { nodeId: "locked-vault-node" } } } });
    } finally {
      member.client.close();
      joiner.client.close();
      await Promise.all([memberHome.stop(), joinerHome.stop()]);
    }
  });

  it("refuses the same workspace id on a second home instead of forging genesis", async () => {
    const memberHome = await startHome("forge-member");
    const otherHome = await startHome("forge-other");
    const member = memberHome.home;
    const other = otherHome.home;
    try {
      const owner = await createGovernedWorkspace(member, "workspace", "Workspace");
      const otherActor = await other.client.createActor({ label: "Other Owner", passphrase: TEST_PASSPHRASE });
      // Creating the same id on another home makes a different journal; the
      // product flow refuses it loudly rather than syncing two geneses.
      await other.client.createWorkspace("workspace", "Workspace", otherActor.actorId);
      const exchanged = await other.client
        .syncWorkspace("workspace", member.exchangeEndpoint)
        .catch((error: unknown) => error);
      expect(exchanged).toBeInstanceOf(Error);
      const summary = await member.client.governanceSummary("workspace");
      expect(summary.ownerActorId).toBe(owner);
      expect(summary.peers).toHaveLength(1);
    } finally {
      member.client.close();
      other.client.close();
      await Promise.all([memberHome.stop(), otherHome.stop()]);
    }
  });

  it("revoking a peer rotates transit past it while the actor stays a member", async () => {
    const memberHome = await startHome("revoke-member");
    const joinerHome = await startHome("revoke-joiner");
    const member = memberHome.home;
    const joiner = joinerHome.home;
    try {
      const owner = await createGovernedWorkspace(member, "workspace", "Workspace");
      await joinHomeToWorkspace({ home: member, actingActorId: owner }, joiner, "workspace");
      const joinerPeerId = (await joiner.client.peerMaterial()).peerId;

      const before = await member.client.governanceSummary("workspace");
      expect(before.epoch).toBe(0);
      await member.client.revokePeer({ workspaceId: "workspace", actingActorId: owner, peerId: joinerPeerId });
      const after = await member.client.governanceSummary("workspace");
      expect(after.epoch).toBe(1);
      expect(after.peers.map((peer) => peer.peerId)).not.toContain(joinerPeerId);

      // The revoked peer can no longer exchange; the member keeps syncing.
      await expect(joiner.client.syncWorkspace("workspace", member.exchangeEndpoint)).rejects.toThrow();
      const exchanged = await member.client.syncWorkspace("workspace", member.exchangeEndpoint);
      expect(exchanged.pulled).toBe(0);
    } finally {
      member.client.close();
      joiner.client.close();
      await Promise.all([memberHome.stop(), joinerHome.stop()]);
    }
  });
});

function nodeAt(nodeId: string, parentNodeId: string, occurrenceId: string) {
  return {
    kind: "node-create" as const,
    nodeId,
    occurrenceId,
    parentNodeId,
    anchor: { after: null, before: null, affinity: "after", fallback: "end" } as const,
  };
}
