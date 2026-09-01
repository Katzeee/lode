import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createEngine, type Engine } from "../src/engine.js";
import type { PersistenceBackend } from "../src/subsystems/persistence/backend.js";
import { NodePersistenceBackend } from "@lode/engine-platform-desktop";
import type {
  PeerTransportPort,
  ReplicaExchangeHandler,
  ReplicaExchangeWire,
} from "../src/subsystems/connection/index.js";
import { createTestEngine, createWorkspaceAs, type TestEngineOptions } from "./support/create-test-engine.js";
import { END_SEQUENCE_ANCHOR as end } from "../src/domain/fact/index.js";
import { InMemoryPersistenceBackend } from "./support/persistence/in-memory-persistence-backend.js";

const temporaryDirectories: string[] = [];
const vaultPassphrase = "engine-composition-passphrase";

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("Engine composition", () => {
  it("separates lifecycle ownership from the pure Engine API", async () => {
    const engine = createTestEngine();
    expect(Object.keys(engine).sort()).toEqual(["api", "start", "stop"]);
    expect(engine.api).not.toHaveProperty("start");
    expect(engine.api).not.toHaveProperty("stop");
    await engine.start();
    await engine.stop();
  });

  it("keeps construction inert and transfers accepted backend and transport ownership to Engine", async () => {
    const events: string[] = [];
    const storage = new InMemoryPersistenceBackend();
    const persistence: PersistenceBackend = {
      openIdentityStorage: () => storage.openIdentityStorage(),
      listWorkspaceIds: () => storage.listWorkspaceIds(),
      openWorkspace: (workspaceId) => storage.openWorkspace(workspaceId),
      stageWorkspace: (workspaceId) => storage.stageWorkspace(workspaceId),
      discardStagedWorkspaces: () => storage.discardStagedWorkspaces(),
      close: () => {
        events.push("persistence:close");
        storage.close();
      },
    };
    const peerTransport: PeerTransportPort = {
      init: () => {
        events.push("connection:init");
      },
      start: () => {
        events.push("connection:start");
      },
      dial: () => {
        throw new Error("not dialed");
      },
      close: () => {
        events.push("connection:close");
      },
    };

    const engine = createEngine({ persistence, peerTransport });
    expect(events).toEqual([]);
    await engine.start();
    expect(events).toContain("connection:init");
    expect(events).toContain("connection:start");

    await engine.stop();
    expect(events.indexOf("connection:close")).toBeLessThan(events.indexOf("persistence:close"));
  });

  it("isolates public Engine event subscribers", async () => {
    const engine = await startEngine();
    const { actorId: actor } = await createWorkspaceAs(engine, "workspace", "Workspace", vaultPassphrase);
    const events: string[] = [];
    engine.api.application.subscribe((event) => {
      const key = Object.keys(event.frontier)[0];
      if (key) {
        (event.frontier as Record<string, number>)[key] = 999;
      }
      throw new Error("injected public listener failure after action attempt");
    }, rethrow);
    engine.api.application.subscribe((event) => events.push(event.kind), rethrow);

    const result = await engine.api.application.execute(createNodeCommand(actor));
    expect(result.status).toBe("published");
    expect(events).toEqual(["authority-advanced", "projection-published"]);
    expect(
      await engine.api.application.query({
        kind: "invocation",
        workspaceId: "workspace",
        invocationId: "create-node",
      }),
    ).toEqual({ status: "ok", value: result });
    await engine.stop();
  });

  it("History restart 与多 channel", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "lode-proposal-engine-"));
    temporaryDirectories.push(dataRoot);
    const first = await startEngine({ persistence: new NodePersistenceBackend(dataRoot) });
    const { actorId: actor } = await createWorkspaceAs(first, "workspace", "Workspace", vaultPassphrase);
    const written = await first.api.application.execute(createNodeCommand(actor));
    await first.api.application.execute({
      ...createNodeCommand(actor),
      invocationId: "mobile-node",
      historyChannelId: "mobile",
      actions: [
        {
          kind: "node-create",
          occurrenceId: "mobile-node-original",
          nodeId: "mobile-node",
          parentNodeId: "workspace",
          anchor: end,
        },
      ],
    });
    await first.stop();

    const restarted = await startEngine({ persistence: new NodePersistenceBackend(dataRoot) });
    await restarted.api.identity.unlockVault(vaultPassphrase);
    const retry = await restarted.api.application.execute(createNodeCommand(actor));
    expect(retry.status).toBe("published");
    if (retry.status === "published" && written.status === "published") {
      expect(retry.receipt).toEqual(written.receipt);
    }
    expect(
      await restarted.api.application.query({
        kind: "projection",
        workspaceId: "workspace",
        perspective: "origin",
      }),
    ).toMatchObject({
      status: "ok",
      value: { nodes: { node: { nodeId: "node" }, "mobile-node": { nodeId: "mobile-node" } } },
    });
    const desktopHistory = await restarted.api.application.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "desktop",
    });
    expect(desktopHistory).toMatchObject({
      status: "ok",
      value: { undo: { channelId: "desktop" } },
    });
    const mobileHistory = await restarted.api.application.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "mobile",
    });
    expect(mobileHistory).toMatchObject({
      status: "ok",
      value: { undo: { channelId: "mobile" } },
    });
    if (desktopHistory.status !== "ok" || !("undo" in desktopHistory.value) || !desktopHistory.value.undo) {
      throw new Error("Expected the restarted desktop History selection");
    }
    expect(
      (
        await restarted.api.application.execute({
          kind: "undo",
          workspaceId: "workspace",
          invocationId: "undo-desktop",
          actorId: actor,
          selection: desktopHistory.value.undo,
        })
      ).status,
    ).toBe("published");
    expect(
      await restarted.api.application.query({
        kind: "projection",
        workspaceId: "workspace",
        perspective: "origin",
      }),
    ).toMatchObject({
      status: "ok",
      value: { nodes: { "mobile-node": { nodeId: "mobile-node" } } },
    });
    await restarted.stop();

    const afterUndoRestart = await startEngine({ persistence: new NodePersistenceBackend(dataRoot) });
    await afterUndoRestart.api.identity.unlockVault(vaultPassphrase);
    const persistedMobileHistory = await afterUndoRestart.api.application.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "mobile",
    });
    if (
      persistedMobileHistory.status !== "ok" ||
      !("undo" in persistedMobileHistory.value) ||
      !persistedMobileHistory.value.undo
    ) {
      throw new Error("Expected the mobile History selection after desktop Undo restart");
    }
    expect(
      (
        await afterUndoRestart.api.application.execute({
          kind: "undo",
          workspaceId: "workspace",
          invocationId: "undo-mobile",
          actorId: actor,
          selection: persistedMobileHistory.value.undo,
        })
      ).status,
    ).toBe("published");
    expect(
      await afterUndoRestart.api.application.query({
        kind: "projection",
        workspaceId: "workspace",
        perspective: "origin",
      }),
    ).toMatchObject({ status: "ok", value: { nodes: {} } });
    await afterUndoRestart.stop();
  });

  it("Review selection remains valid across a durable engine restart", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "lode-review-selection-"));
    temporaryDirectories.push(dataRoot);
    const first = await startEngine({ persistence: new NodePersistenceBackend(dataRoot) });
    const { actorId: actor } = await createWorkspaceAs(first, "workspace", "Workspace", vaultPassphrase);
    expect(
      (
        await first.api.application.execute({
          ...createNodeCommand(actor),
          invocationId: "proposal-create",
          intent: "proposal",
          actions: [
            {
              kind: "node-create",
              occurrenceId: "proposal-node-original",
              nodeId: "proposal-node",
              parentNodeId: "workspace",
              anchor: end,
            },
          ],
        })
      ).status,
    ).toBe("published");
    const review = await first.api.application.query({ kind: "review", workspaceId: "workspace" });
    if (review.status !== "ok" || !("hunks" in review.value) || !review.value.hunks[0]) {
      throw new Error("Expected a durable Review selection");
    }
    const selection = review.value.hunks[0].selection;
    await first.stop();

    const restarted = await startEngine({ persistence: new NodePersistenceBackend(dataRoot) });
    await restarted.api.identity.unlockVault(vaultPassphrase);
    expect(
      (
        await restarted.api.application.execute({
          kind: "resolve-review",
          workspaceId: "workspace",
          invocationId: "accept-after-restart",
          actorId: actor,
          decision: "accept",
          selection,
        })
      ).status,
    ).toBe("published");
    expect(
      await restarted.api.application.query({
        kind: "projection",
        workspaceId: "workspace",
        perspective: "origin",
      }),
    ).toMatchObject({
      status: "ok",
      value: { nodes: { "proposal-node": { nodeId: "proposal-node" } } },
    });
    await restarted.stop();
  });

  it("restores one Actor on a second Home and adopts the workspace through the exchange", async () => {
    const leftRoot = await mkdtemp(join(tmpdir(), "lode-two-homes-left-"));
    const rightRoot = await mkdtemp(join(tmpdir(), "lode-two-homes-right-"));
    temporaryDirectories.push(leftRoot, rightRoot);
    const network = new InProcessPeerNetwork();
    const left = await startEngine({
      persistence: new NodePersistenceBackend(leftRoot),
      peerTransport: network.transport("left"),
    });
    const bootstrap = await createWorkspaceAs(left, "workspace", "Workspace", vaultPassphrase);
    const owner = bootstrap.actorId;
    // The second Home restores the SAME Actor from its recovery phrase and
    // adopts the journal from the first Home's exchange boundary; both Homes
    // then converge with their own Peer and Replica identities.
    const right = await startEngine({
      persistence: new NodePersistenceBackend(rightRoot),
      peerTransport: network.transport("right"),
    });
    try {
      const rightMaterial = await right.api.identity.peerMaterial();
      const imported = await right.api.identity.importActor({
        recoveryPhrase: bootstrap.recoveryPhrase,
        passphrase: vaultPassphrase,
        label: "Restored Owner",
      });
      expect(imported.actorId).toBe(owner);
      await left.api.governance.admitPeer({
        workspaceId: "workspace",
        actingActorId: owner,
        peerId: rightMaterial.peerId,
        peerKxPublicKey: rightMaterial.peerKxPublicKey,
      });
      const adopted = await right.api.workspaces.adoptWorkspace({ endpoint: "left", workspaceId: "workspace" });
      expect(adopted).toEqual({ workspaceId: "workspace", label: "Workspace" });

      const events: string[] = [];
      right.api.application.subscribe((event) => events.push(event.kind), rethrow);
      await left.api.application.execute(createNodeCommand(owner));
      await left.api.replicas.synchronize("workspace", "right");
      expect(
        await right.api.application.query({
          kind: "projection",
          workspaceId: "workspace",
          perspective: "origin",
        }),
      ).toMatchObject({ status: "ok", value: { nodes: { node: { nodeId: "node" } } } });
      expect(events).toContain("authority-advanced");
      expect(events).toContain("projection-published");

      const leftSummary = await left.api.governance.summary("workspace");
      const rightSummary = await right.api.governance.summary("workspace");
      expect(new Set(leftSummary.peers.map((peer) => peer.peerId))).toEqual(
        new Set(rightSummary.peers.map((peer) => peer.peerId)),
      );
      expect(leftSummary.memberActorIds).toContain(owner);
      expect(rightSummary.memberActorIds).toContain(owner);
      // The same Actor writes from both Homes under distinct Replicas.
      const rightWrite = await right.api.application.execute({
        ...createNodeCommand(owner),
        invocationId: "right-node",
        actions: [
          {
            kind: "node-create",
            occurrenceId: "right-node-original",
            nodeId: "right-node",
            parentNodeId: "workspace",
            anchor: end,
          },
        ],
      });
      expect(rightWrite.status).toBe("published");
      await right.api.replicas.synchronize("workspace", "left");
      void owner;
      expect(
        await left.api.application.query({
          kind: "projection",
          workspaceId: "workspace",
          perspective: "origin",
        }),
      ).toMatchObject({ status: "ok", value: { nodes: { "right-node": { nodeId: "right-node" } } } });
    } finally {
      await Promise.all([left.stop(), right.stop()]);
    }
  });

  it("failed adoption discards its staging Workspace immediately", async () => {
    const network = new InProcessPeerNetwork();
    const serving = await startEngine({ peerTransport: network.transport("serving") });
    const joining = await startEngine({ peerTransport: network.transport("joining") });
    try {
      await expect(
        joining.api.workspaces.adoptWorkspace({ workspaceId: "missing", endpoint: "serving" }),
      ).rejects.toThrow("does not exist");
      expect(await joining.api.workspaces.listWorkspaces()).toEqual([]);

      const owner = await joining.api.identity.createActor({ label: "Owner", passphrase: vaultPassphrase });
      await expect(
        joining.api.workspaces.createWorkspace({
          workspaceId: "missing",
          label: "Local",
          ownerActorId: owner.actorId,
        }),
      ).resolves.toBeUndefined();
    } finally {
      await Promise.all([serving.stop(), joining.stop()]);
    }
  });

  it("rejects locally authored governance that the deterministic replay would skip", async () => {
    const engine = await startEngine();
    try {
      const owner = await engine.api.identity.createActor({ label: "Owner", passphrase: vaultPassphrase });
      const member = await engine.api.identity.createActor({ label: "Member", passphrase: vaultPassphrase });
      const target = await engine.api.identity.createActor({ label: "Target", passphrase: vaultPassphrase });
      await engine.api.workspaces.createWorkspace({
        workspaceId: "workspace",
        label: "Workspace",
        ownerActorId: owner.actorId,
      });
      await engine.api.governance.admitActor({
        workspaceId: "workspace",
        actingActorId: owner.actorId,
        actorId: member.actorId,
      });

      await expect(
        engine.api.governance.admitActor({
          workspaceId: "workspace",
          actingActorId: member.actorId,
          actorId: target.actorId,
        }),
      ).rejects.toThrow("not the Workspace owner");
      await expect(
        engine.api.governance.rotateTransit({ workspaceId: "workspace", actingActorId: member.actorId }),
      ).rejects.toThrow("not the Workspace owner");
      expect((await engine.api.governance.summary("workspace")).memberActorIds).not.toContain(target.actorId);
    } finally {
      await engine.stop();
    }
  });
});

async function startEngine(options: TestEngineOptions = {}): Promise<Engine> {
  const engine = createTestEngine(options);
  await engine.start();
  return engine;
}

class InProcessPeerNetwork {
  private readonly handlers = new Map<string, ReplicaExchangeHandler>();

  transport(endpoint: string): PeerTransportPort {
    let owned: ReplicaExchangeHandler | undefined;
    const remote = (target: string): ReplicaExchangeHandler => {
      const handler = this.handlers.get(target);
      if (!handler) {
        throw new Error(`In-process Peer endpoint is unavailable: ${target}`);
      }
      return handler;
    };
    return {
      start: (handler) => {
        owned = handler;
        this.handlers.set(endpoint, handler);
      },
      dial: (target): ReplicaExchangeWire => ({
        profile: (proof) => remote(target).exchangeProfile(proof),
        fetch: (proof, documentId, sealedFrom) => remote(target).exchangeFetch(proof, documentId, sealedFrom),
        send: (proof, documentId, sealedPayload) => remote(target).exchangeSend(proof, documentId, sealedPayload),
      }),
      close: () => {
        if (this.handlers.get(endpoint) === owned) {
          this.handlers.delete(endpoint);
        }
      },
    };
  }
}

function createNodeCommand(actorId: string) {
  return {
    kind: "edit",
    workspaceId: "workspace",
    invocationId: "create-node",
    actorId,
    intent: "direct",
    historyChannelId: "desktop",
    actions: [
      {
        kind: "node-create",
        occurrenceId: "node-original",
        nodeId: "node",
        parentNodeId: "workspace",
        anchor: end,
      },
    ],
  } as const;
}

function rethrow(error: unknown): never {
  throw error;
}
