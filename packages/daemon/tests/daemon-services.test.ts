import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDesktopClient } from "@lode/desktop-client";
import { createEngine } from "@lode/engine/host";
import { Code } from "@connectrpc/connect";
import { afterEach, describe, expect, it } from "vitest";

import { startDaemon } from "../src/daemon.js";

const accessToken = "lode-test-transport-access-token";
const temporaryDirectories: string[] = [];

async function startTestDaemon(options: Readonly<{ listen: string; dataRoot: string; accessToken: string }>) {
  const engine = await createEngine({ persistence: { dataRoot: options.dataRoot } });
  return startDaemon({ engine, listen: options.listen, accessToken: options.accessToken });
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("generated daemon service adapters", () => {
  it("preserves completion, retry and read-your-write semantics", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "lode-ipc-contract-"));
    temporaryDirectories.push(dataRoot);
    const daemon = await startTestDaemon({
      listen: "tcp://127.0.0.1:0",
      dataRoot,
      accessToken,
    });
    const client = createDesktopClient(daemon.address, accessToken);
    const unauthenticated = createDesktopClient(daemon.address, "wrong-token");
    try {
      await expect(unauthenticated.openWorkspace("workspace")).rejects.toMatchObject({
        code: Code.Unauthenticated,
      });
      expect(Object.keys(client).sort()).toEqual([
        "close",
        "closeWorkspace",
        "execute",
        "openWorkspace",
        "query",
        "recoverWorkspaceAuthority",
        "subscribe",
        "syncWorkspace",
      ]);
      expect(client).not.toHaveProperty("request");
      expect(client).not.toHaveProperty("rpc");
      await client.openWorkspace("workspace");
      const command = {
        kind: "mutate",
        workspaceId: "workspace",
        invocationId: "ipc-create",
        actorId: "actor",
        intent: "direct",
        historyChannelId: "desktop",
        mutations: [
          nodeAt("node", "workspace", "node-original"),
          { ...nodeAt("tag", "workspace", "tag-original"), intrinsicNodeType: "supertag-definition" as const },
          {
            kind: "supertag-application-create",
            hostNodeId: "node",
            metanodeId: "node-metanode",
            supertagId: "tag",
            applicationNodeId: "node-tag-application",
            applicationOccurrenceId: "node-tag-application-occurrence",
            relationDefinitionOccurrenceId: "node-tag-relation-definition-occurrence",
            definitionOccurrenceId: "node-tag-definition-occurrence",
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
            node: [{ relationDefinitionOccurrenceId: "node-tag-relation-definition-occurrence" }],
          },
        },
      });

      expect(
        await client.execute({
          ...command,
          invocationId: "invalid-ipc",
          mutations: [{ kind: "future-mutation", extra: true }],
        } as never),
      ).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });
      for (const intent of ["direct", "proposal"] as const) {
        expect(
          await client.execute({
            kind: "mutate",
            workspaceId: "workspace",
            invocationId: `invalid-structural-${intent}`,
            actorId: "actor",
            intent,
            historyChannelId: "desktop",
            mutations: [
              {
                kind: "occurrence-delete",
                occurrenceId: "node-tag-definition-occurrence",
              },
            ],
          }),
        ).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });
      }
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
          supertagApplications: { node: [{ definitionOccurrenceId: "node-tag-definition-occurrence" }] },
        },
      });
      expect(await client.closeWorkspace("workspace")).toBe(true);
      expect(await client.closeWorkspace("workspace")).toBe(false);
      expect(await client.recoverWorkspaceAuthority("workspace")).toBe(false);
    } finally {
      unauthenticated.close();
      client.close();
      await daemon.stop();
    }
  });

  it("carries a public View removal through the daemon as graph truth", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "lode-ipc-view-detach-"));
    temporaryDirectories.push(dataRoot);
    const daemon = await startTestDaemon({
      listen: "tcp://127.0.0.1:0",
      dataRoot,
      accessToken,
    });
    const client = createDesktopClient(daemon.address, accessToken);
    try {
      await client.openWorkspace("workspace");
      const creation = await client.execute({
        kind: "mutate",
        workspaceId: "workspace",
        invocationId: "ipc-view-create",
        actorId: "actor",
        intent: "direct",
        historyChannelId: "desktop",
        mutations: [
          nodeAt("host", "workspace", "host-original"),
          {
            kind: "shared-default-view-definition-create",
            hostNodeId: "host",
            metanodeId: "host-metanode",
            attachmentNodeId: "host-view-attachment",
            attachmentOccurrenceId: "host-view-attachment-occurrence",
            relationDefinitionOccurrenceId: "host-view-attachment-definition",
            viewDefinitionNodeId: "host-view",
            viewDefinitionOccurrenceId: "host-view-occurrence",
            viewType: "table",
            anchor: { after: null, before: null, affinity: "after", fallback: "end" },
          },
        ],
      });
      expect(creation, JSON.stringify(creation)).toMatchObject({ status: "published" });
      expect(
        await client.query({
          kind: "projection",
          workspaceId: "workspace",
          perspective: "origin",
          section: "sharedDefaultViewDefinitions",
        }),
      ).toMatchObject({
        status: "ok",
        value: { sharedDefaultViewDefinitions: { host: [{ viewDefinitionNodeId: "host-view", viewType: "table" }] } },
      });

      const removal = await client.execute({
        kind: "mutate",
        workspaceId: "workspace",
        invocationId: "ipc-view-remove",
        actorId: "actor",
        intent: "direct",
        historyChannelId: "desktop",
        mutations: [
          {
            kind: "shared-default-view-definition-remove",
            hostNodeId: "host",
            attachmentNodeId: "host-view-attachment",
            attachmentOccurrenceId: "host-view-attachment-occurrence",
            relationDefinitionOccurrenceId: "host-view-attachment-definition",
            viewDefinitionNodeId: "host-view",
            viewDefinitionOccurrenceId: "host-view-occurrence",
          },
        ],
      });
      expect(removal, JSON.stringify(removal)).toMatchObject({ status: "published" });
      const [definitions, owners, children] = await Promise.all([
        client.query({
          kind: "projection",
          workspaceId: "workspace",
          perspective: "origin",
          section: "sharedDefaultViewDefinitions",
        }),
        client.query({
          kind: "projection",
          workspaceId: "workspace",
          perspective: "origin",
          section: "nodeOwners",
        }),
        client.query({
          kind: "projection",
          workspaceId: "workspace",
          perspective: "origin",
          section: "childOccurrences",
        }),
      ]);
      expect(definitions).toMatchObject({ status: "ok", value: { sharedDefaultViewDefinitions: {} } });
      expect(owners).toMatchObject({
        status: "ok",
        value: {
          nodeOwners: {
            "host-view-attachment": "workspace-trash:v1:workspace",
            "host-view": "workspace-trash:v1:workspace",
            "detached-view-value:v1:host-view-attachment": "host-view-attachment",
          },
        },
      });
      expect(children).toMatchObject({
        status: "ok",
        value: {
          childOccurrences: {
            "host-view-attachment": [
              "host-view-attachment-definition",
              "detached-view-value-occ:v1:host-view-attachment",
            ],
          },
        },
      });
    } finally {
      client.close();
      await daemon.stop();
    }
  });

  it("daemon sync RPC composes the production Fact SyncExchange across replicas", async () => {
    const leftRoot = await mkdtemp(join(tmpdir(), "lode-ipc-sync-left-"));
    const rightRoot = await mkdtemp(join(tmpdir(), "lode-ipc-sync-right-"));
    temporaryDirectories.push(leftRoot, rightRoot);
    const leftDaemon = await startTestDaemon({
      listen: "tcp://127.0.0.1:0",
      dataRoot: leftRoot,
      accessToken,
    });
    const rightDaemon = await startTestDaemon({
      listen: "tcp://127.0.0.1:0",
      dataRoot: rightRoot,
      accessToken,
    });
    const left = createDesktopClient(leftDaemon.address, accessToken);
    const right = createDesktopClient(rightDaemon.address, accessToken);
    try {
      await Promise.all([left.openWorkspace("workspace"), right.openWorkspace("workspace")]);
      expect(
        (
          await left.execute({
            kind: "mutate",
            workspaceId: "workspace",
            invocationId: "left-node",
            actorId: "left",
            intent: "direct",
            historyChannelId: "desktop",
            mutations: [nodeAt("from-left", "workspace", "from-left-original")],
          })
        ).status,
      ).toBe("published");

      await left.syncWorkspace("workspace", rightDaemon.address);

      expect(
        await right.query({
          kind: "projection",
          workspaceId: "workspace",
          perspective: "origin",
        }),
      ).toMatchObject({
        status: "ok",
        value: { nodes: { "from-left": { nodeId: "from-left" } } },
      });
    } finally {
      left.close();
      right.close();
      await Promise.all([leftDaemon.stop(), rightDaemon.stop()]);
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
