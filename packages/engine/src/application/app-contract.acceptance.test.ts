import { describe, expect, it } from "vitest";

import { InMemoryDocumentStore } from "../persistence/in-memory-document-store.js";
import { admitAuthorityRecords } from "../domain/admission/index.js";
import { templateInstanceNodeId, templateInstanceOccurrenceId } from "../domain/fact/index.js";
import { FactAuthorityStore, createReplicaId } from "../runtime/authority/fact-authority-store.js";
import { ProposalWorkspace } from "../runtime/workspace/proposal-workspace.js";
import {
  createEngineTransportServer,
  createTransportEngineContract,
  type EngineTransport,
} from "./transport.js";
import { ProposalWorkspaceRegistry } from "../runtime/workspace/proposal-registry.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

function nodeAtWorkspace(nodeId: string) {
  return [nodeAt(nodeId, "workspace", `${nodeId}-original`)];
}

function nodeAt(nodeId: string, parentNodeId: string, occurrenceId: string) {
  return { kind: "node-create" as const, nodeId, occurrenceId, parentNodeId, anchor: end };
}

async function setup() {
  const facts = await FactAuthorityStore.open({
    workspaceId: "workspace",
    replicaId: createReplicaId(),
    loroPeerId: "101",
    documents: new InMemoryDocumentStore(),
    admitRecords: admitAuthorityRecords,
  });
  const workspace = await ProposalWorkspace.open({
    workspaceId: "workspace",
    facts,
    versions: { rulesVersion: "proposal-rules-5", schemaVersion: "lode-schema-19" },
  });
  const registry = new ProposalWorkspaceRegistry();
  registry.register(workspace);
  const direct = registry.contract;
  return {
    facts,
    direct,
    serialized: createTransportEngineContract(createEngineTransportServer(direct)),
  };
}

const command = {
  kind: "mutate",
  workspaceId: "workspace",
  invocationId: "invocation",
  actorId: "actor",
  intent: "direct",
  historyChannelId: "surface",
  mutations: [
    {
      kind: "node-create",
      occurrenceId: "node-original",
      nodeId: "node",
      parentNodeId: "workspace",
      anchor: end,
    },
  ],
} as const;

describe("transport-neutral App contract", () => {
  it("CMD-1 app capability exposes only the typed engine contract", async () => {
    const { direct } = await setup();
    expect(Object.keys(direct).sort()).toEqual(["execute", "query", "subscribe"]);
    expect(direct).not.toHaveProperty("factStore");
    expect(direct).not.toHaveProperty("appendFact");
    expect(direct).not.toHaveProperty("workspaceRuntime");
    expect(direct).not.toHaveProperty("materializer");
  });

  it("in-process and serialized adapters share command completion and query semantics", async () => {
    const directSetup = await setup();
    const serializedSetup = await setup();
    const directResult = await directSetup.direct.execute(command);
    const serializedResult = await serializedSetup.serialized.execute(command);
    expect(serializedResult.status).toBe(directResult.status);
    expect(
      await serializedSetup.serialized.query({
        kind: "projection",
        workspaceId: "workspace",
        view: "origin",
      }),
    ).toMatchObject({ status: "ok", value: { nodes: { node: { nodeId: "node" } } } });
  });

  it("Invocation retry", async () => {
    const { serialized, facts } = await setup();
    const first = await serialized.execute(command);
    const retry = await serialized.execute(command);
    expect(retry).toEqual(first);
    expect(facts.snapshot().facts).toHaveLength(4);
  });

  it("Schema Search is a bounded serialized query with stable cursors", async () => {
    const { serialized } = await setup();
    expect(
      (
        await serialized.execute({
          ...command,
          invocationId: "schema-search-setup",
          mutations: [
            ...nodeAtWorkspace("anime"),
            {
              kind: "node-type-declare",
              nodeId: "anime",
              nodeType: "schema",
            },
            ...["a", "b", "c", "d", "e"].flatMap((nodeId) => [
              ...nodeAtWorkspace(nodeId),
              { kind: "schema-apply" as const, nodeId, schemaId: "anime", anchor: end },
            ]),
          ],
        })
      ).status,
    ).toBe("published");

    const first = await serialized.query({
      kind: "schema-search",
      workspaceId: "workspace",
      view: "origin",
      schemaId: "anime",
      limit: 2,
    });
    expect(first).toMatchObject({
      status: "ok",
      value: { view: "origin", schemaId: "anime", nodeIds: ["a", "b"], next: "b" },
    });
    if (first.status !== "ok" || !("nodeIds" in first.value)) {
      throw new Error("Expected Schema Search result");
    }
    const second = await serialized.query({
      kind: "schema-search",
      workspaceId: "workspace",
      view: "origin",
      schemaId: "anime",
      after: first.value.next,
      limit: 2,
    });
    expect(second).toMatchObject({
      status: "ok",
      value: { nodeIds: ["c", "d"], next: "d" },
    });

    expect(
      (
        await serialized.execute({
          ...command,
          invocationId: "delete-search-schema",
          mutations: [{ kind: "node-delete", nodeId: "anime" }],
        })
      ).status,
    ).toBe("published");
    const statuses = await serialized.query({
      kind: "projection",
      workspaceId: "workspace",
      view: "origin",
      section: "nodeStatuses",
    });
    expect(statuses).toMatchObject({
      status: "ok",
      value: {
        nodeStatuses: {
          anime: {
            nodeId: "anime",
            nodeType: "schema",
            state: "deleted",
          },
        },
      },
    });
  });

  it("ordinary Template Nodes detach through the serialized contract", async () => {
    const { serialized } = await setup();
    const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;
    expect(
      (
        await serialized.execute({
          ...command,
          invocationId: "serialized-template-setup",
          mutations: [
            nodeAt("note-schema", "workspace", "note-schema-original"),
            {
              kind: "node-type-declare",
              nodeId: "note-schema",
              nodeType: "schema",
            },
            nodeAt("guidance", "note-schema", "note-schema-guidance-template-occurrence"),
            nodeAt("note", "workspace", "note-occurrence"),
            {
              kind: "schema-template-node-add",
              schemaId: "note-schema",
              templateNodeId: "guidance",
              templateOccurrenceId: "note-schema-guidance-template-occurrence",
              anchor: end,
            },
            { kind: "schema-apply", nodeId: "note", schemaId: "note-schema", anchor: end },
          ],
        })
      ).status,
    ).toBe("published");

    const instanceNodeId = templateInstanceNodeId("note", "guidance");
    const instanceOccurrenceId = templateInstanceOccurrenceId("note", "guidance");
    expect(
      (
        await serialized.execute({
          ...command,
          invocationId: "serialized-template-detach",
          mutations: [
            {
              kind: "template-node-detach",
              ownerNodeId: "note",
              templateNodeId: "guidance",
              instanceNodeId,
              instanceOccurrenceId,
              anchor: end,
            },
          ],
        })
      ).status,
    ).toBe("published");
    expect(
      await serialized.query({
        kind: "projection",
        workspaceId: "workspace",
        view: "origin",
        section: "templateNodeInstances",
      }),
    ).toMatchObject({
      status: "ok",
      value: {
        templateNodeInstances: [
          {
            ownerNodeId: "note",
            templateNodeId: "guidance",
            instanceNodeId,
            instanceOccurrenceId,
            state: "detached",
          },
        ],
      },
    });
  });

  it("instance Field content deletion crosses the closed serialized contract", async () => {
    const { serialized } = await setup();
    const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;
    expect(
      (
        await serialized.execute({
          ...command,
          invocationId: "serialized-field-setup",
          mutations: [
            nodeAt("owner", "workspace", "owner-occurrence"),
            nodeAt("schema", "workspace", "schema-original"),
            nodeAt("field-definition", "workspace", "field-definition-original"),
            { kind: "node-type-declare", nodeId: "schema", nodeType: "schema" },
            {
              kind: "node-type-declare",
              nodeId: "field-definition",
              nodeType: "field-definition",
            },
            nodeAt("field-node", "owner", "field-occurrence"),
            nodeAt("value", "field-node", "value-occurrence"),
            {
              kind: "schema-field-add",
              schemaId: "schema",
              fieldDefinitionId: "field-definition",
              fieldNodeId: "schema-field-definition-template-field",
              fieldOccurrenceId: "schema-field-definition-template-field-occurrence",
              anchor: end,
            },
            { kind: "schema-apply", nodeId: "owner", schemaId: "schema", anchor: end },
            {
              kind: "field-materialize",
              ownerNodeId: "owner",
              fieldDefinitionId: "field-definition",
              fieldNodeId: "field-node",
              fieldOccurrenceId: "field-occurrence",
            },
          ],
        })
      ).status,
    ).toBe("published");
    expect(
      (
        await serialized.execute({
          ...command,
          invocationId: "serialized-value-delete",
          mutations: [
            {
              kind: "field-value-delete",
              ownerNodeId: "owner",
              fieldDefinitionId: "field-definition",
              valueOccurrenceId: "value-occurrence",
            },
          ],
        })
      ).status,
    ).toBe("published");
    expect(
      await serialized.query({
        kind: "projection",
        workspaceId: "workspace",
        view: "origin",
        section: "materializedFields",
      }),
    ).toMatchObject({
      status: "ok",
      value: { materializedFields: { owner: [{ valueOccurrenceIds: [] }] } },
    });
    expect(
      await serialized.execute({
        ...command,
        invocationId: "reject-open-field-delete-shape",
        mutations: [
          {
            kind: "materialized-field-delete",
            ownerNodeId: "owner",
            fieldDefinitionId: "field-definition",
            fieldNodeId: "field-node",
            fieldOccurrenceId: "field-occurrence",
            unknown: true,
          } as never,
        ],
      }),
    ).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });
  });

  it("Hard Delete maintenance remains a closed serialized contract", async () => {
    const { serialized } = await setup();
    expect((await serialized.execute(command)).status).toBe("published");
    const deletion = await serialized.execute({
      ...command,
      invocationId: "serialized-delete",
      mutations: [{ kind: "node-delete", nodeId: "node" }],
    });
    if (deletion.status !== "published" || !deletion.receipt.factIds[0]) {
      throw new Error("Expected serialized tombstone");
    }
    const deletionFactIds = [deletion.receipt.factIds[0]];
    let preview = await serialized.query({
      kind: "hard-delete-preview",
      workspaceId: "workspace",
      nodeId: "node",
    });
    if (preview.status !== "ok" || !("blockers" in preview.value)) {
      throw new Error("Expected serialized Hard Delete preview");
    }
    expect(preview.value.blockers).toContain("replica-unconfirmed");
    expect(preview.value.historyImpact).toMatchObject({
      affectedChannelIds: ["surface"],
      totalAffectedInvocations: 2,
      truncated: false,
    });

    expect(
      (
        await serialized.execute({
          kind: "acknowledge-deletion",
          workspaceId: "workspace",
          invocationId: "serialized-ack",
          actorId: "maintainer",
          nodeId: "node",
          deletionFactIds,
        })
      ).status,
    ).toBe("published");
    preview = await serialized.query({
      kind: "hard-delete-preview",
      workspaceId: "workspace",
      nodeId: "node",
    });
    if (preview.status !== "ok" || !("blockers" in preview.value)) {
      throw new Error("Expected executable Hard Delete preview");
    }
    expect(preview.value.canExecute).toBe(true);
    expect(
      (
        await serialized.execute({
          kind: "hard-delete",
          workspaceId: "workspace",
          invocationId: "serialized-purge",
          actorId: "maintainer",
          selection: preview.value.selection,
        })
      ).status,
    ).toBe("published");
  });

  it("Invocation identity conflict", async () => {
    const { serialized } = await setup();
    await serialized.execute(command);
    expect(
      await serialized.execute({
        ...command,
        mutations: nodeAtWorkspace("other"),
      }),
    ).toMatchObject({ status: "rejected", error: { code: "invocation-conflict" } });
  });

  it("wire and in-process invalid inputs reject before any authority record is written", async () => {
    const { direct, facts } = await setup();
    expect(
      await direct.execute({
        ...command,
        invocationId: "bare-node-identity",
        mutations: [{ kind: "node-create", nodeId: "bare" }],
      } as never),
    ).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });
    const invalid = {
      ...command,
      invocationId: "",
      mutations: [{ kind: "future-mutation", futureSemantic: true }],
    };
    expect(await direct.execute(invalid as never)).toMatchObject({
      status: "rejected",
      error: { code: "invalid-input" },
    });
    const server = createEngineTransportServer(direct);
    const response = JSON.parse(
      new TextDecoder().decode(
        await server.request(
          new TextEncoder().encode(JSON.stringify({ kind: "command", command: invalid })),
        ),
      ),
    ) as { result: unknown };
    expect(response.result).toMatchObject({
      status: "rejected",
      error: { code: "invalid-input" },
    });
    expect(facts.admission().snapshot.facts).toHaveLength(2);
    expect(facts.receipts()).toHaveLength(1);
  });

  it("pre-send encoding failures and raw malformed envelopes are typed invalid input", async () => {
    const { direct, serialized, facts } = await setup();
    const invalid = {
      ...command,
      mutations: [
        {
          kind: "value-set",
          target: { kind: "node", id: "node" },
          namespace: "property",
          key: "bigint",
          value: 1n,
          previous: { kind: "unset" },
        },
      ],
    };
    expect(await direct.execute(invalid as never)).toEqual(
      await serialized.execute(invalid as never),
    );
    expect(await serialized.execute(invalid as never)).toMatchObject({
      status: "rejected",
      error: { code: "invalid-input" },
    });

    const server = createEngineTransportServer(direct);
    for (const envelope of [null, { kind: "future", payload: true }]) {
      const response = JSON.parse(
        new TextDecoder().decode(
          await server.request(new TextEncoder().encode(JSON.stringify(envelope))),
        ),
      ) as { kind: string; result: unknown };
      expect(response).toMatchObject({
        kind: "write-result",
        result: { status: "rejected", error: { code: "invalid-input" } },
      });
    }
    expect(facts.admission().snapshot.facts).toHaveLength(2);
    expect(facts.receipts()).toHaveLength(1);
  });

  it("Command outcome unknown", async () => {
    const { direct } = await setup();
    const server = createEngineTransportServer(direct);
    let loseResponse = true;
    const lossy: EngineTransport = {
      async request(bytes) {
        const result = await server.request(bytes);
        if (loseResponse) {
          loseResponse = false;
          throw new Error("response lost after execution");
        }
        return result;
      },
      subscribe: server.subscribe,
    };
    const adapter = createTransportEngineContract(lossy);
    expect(await adapter.execute(command)).toEqual({
      status: "outcome-unknown",
      invocationId: "invocation",
    });
    expect(
      await adapter.query({
        kind: "invocation",
        workspaceId: "workspace",
        invocationId: "invocation",
      }),
    ).toMatchObject({
      status: "ok",
      value: { status: "published", receipt: { invocationId: "invocation" } },
    });
  });

  it("serialized responses and events are closed typed contracts", async () => {
    const listeners = new Set<(bytes: Uint8Array) => void>();
    const malformed: EngineTransport = {
      request(bytes) {
        const request = JSON.parse(new TextDecoder().decode(bytes)) as { kind: string };
        return Promise.resolve(
          new TextEncoder().encode(
            JSON.stringify(
              request.kind === "command"
                ? { kind: "write-result", result: { status: "published" } }
                : { kind: "query-result", result: { status: "ok", value: { future: true } } },
            ),
          ),
        );
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const adapter = createTransportEngineContract(malformed);
    expect(await adapter.execute(command)).toEqual({
      status: "outcome-unknown",
      invocationId: command.invocationId,
    });
    expect(
      await adapter.query({
        kind: "projection",
        workspaceId: "workspace",
        view: "origin",
      }),
    ).toMatchObject({ status: "rejected", error: { code: "projection-unavailable" } });
    let delivered = 0;
    adapter.subscribe(() => {
      delivered += 1;
    });
    for (const listener of listeners) {
      listener(new TextEncoder().encode(JSON.stringify({ kind: "projection-published" })));
    }
    expect(delivered).toBe(0);
  });

  it("EVENT-1 events carry publication state and queries carry snapshots", async () => {
    const { serialized } = await setup();
    const events: unknown[] = [];
    serialized.subscribe(() => {
      throw new Error("injected serialized listener failure");
    });
    const unsubscribe = serialized.subscribe((event) => events.push(event));
    await serialized.execute(command);
    unsubscribe();
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ kind: "authority-advanced", workspaceId: "workspace" });
    expect(events[1]).toMatchObject({ kind: "projection-published", workspaceId: "workspace" });
    expect(
      events.every(
        (event) => typeof event === "object" && event !== null && !Object.hasOwn(event, "facts"),
      ),
    ).toBe(true);
    const first = await serialized.query({
      kind: "projection",
      workspaceId: "workspace",
      view: "origin",
    });
    const second = await serialized.query({
      kind: "projection",
      workspaceId: "workspace",
      view: "origin",
    });
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});
