import { describe, expect, it } from "vitest";

import { InMemoryDocumentStore } from "../../persistence/in-memory-document-store.js";
import {
  SYSTEM_DEFINITION_CATALOG_NODE_ID,
  templateInstanceNodeId,
  templateInstanceOccurrenceId,
  workspaceTrashNodeId,
} from "../../../domain/fact/index.js";
import { FactAuthority } from "../authority/fact-authority.js";
import { Workspace } from "../workspace.js";
import {
  createTransportEngineApplication,
  decodeEngineQueryResult,
  decodeWriteResult,
  encodeEngineCommand,
  encodeEngineQuery,
  type EngineApplicationContract,
  type EngineQueryForKind,
  type EngineQueryInput,
  type EngineQueryKind,
  type EngineQueryResult,
  type EngineTransport,
} from "@lode/sdk";
import { createEngineTransportServer } from "../../../../tests/support/application-transport.js";
import { CURRENT_PROJECTION_VERSIONS } from "../../../domain/reconcile/index.js";
import { createSupertagApplication } from "../../../../tests/support/workspace/edit-test-actions.js";
import { buildEngineSubsystems } from "../../index.js";
import { createEventSubsystemDefinition } from "../../event/event-subsystem.js";
import { parseEngineQuery } from "./input-validation.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

function nodeAtWorkspace(nodeId: string, intrinsicNodeType?: "supertag-definition" | "field-definition") {
  return [nodeAt(nodeId, "workspace", `${nodeId}-original`, intrinsicNodeType)];
}

function nodeAt(
  nodeId: string,
  parentNodeId: string,
  occurrenceId: string,
  intrinsicNodeType?: "supertag-definition" | "field-definition",
) {
  return {
    kind: "node-create" as const,
    nodeId,
    occurrenceId,
    parentNodeId,
    anchor: end,
    ...(intrinsicNodeType === undefined ? {} : { intrinsicNodeType }),
  };
}

async function setup() {
  const facts = await FactAuthority.open({
    workspaceId: "workspace",
    loroPeerId: "101",
    documents: new InMemoryDocumentStore(),
  });
  const event = createEventSubsystemDefinition();
  const events = buildEngineSubsystems([event] as const, ({ event: capability }) => capability);
  await events.lifecycle.start();
  const workspace = await Workspace.open({
    workspaceId: "workspace",
    facts,
    versions: CURRENT_PROJECTION_VERSIONS,
    eventSink: events.api,
  });
  const direct: EngineApplicationContract = {
    execute: (command: Parameters<typeof workspace.execute>[0]) => workspace.execute(command),
    query: async <Kind extends EngineQueryKind>(
      query: EngineQueryInput<Kind>,
    ): Promise<EngineQueryResult<EngineQueryForKind<Kind>>> => {
      let parsed;
      try {
        parsed = parseEngineQuery(query);
      } catch (error) {
        return {
          status: "rejected",
          error: {
            code: "invalid-input",
            message: error instanceof Error ? error.message : String(error),
            currentGenerationId: null,
          },
        };
      }
      try {
        const value = await workspace.query(parsed as EngineQueryInput<Kind>);
        return { status: "ok", value } as EngineQueryResult<EngineQueryForKind<Kind>>;
      } catch (error) {
        return {
          status: "rejected",
          error: {
            code: "projection-unavailable",
            message: error instanceof Error ? error.message : String(error),
            currentGenerationId: null,
          },
        };
      }
    },
    subscribe: events.api.subscribe,
  };
  return {
    facts,
    direct,
    serialized: createTransportEngineApplication(createEngineTransportServer(direct)),
  };
}

const command = {
  kind: "edit",
  workspaceId: "workspace",
  invocationId: "invocation",
  actorId: "actor",
  intent: "direct",
  historyChannelId: "surface",
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

describe("transport-neutral SDK contract", () => {
  it("CMD-1 app capability exposes only the typed engine contract", async () => {
    const { direct } = await setup();
    expect(Object.keys(direct).sort()).toEqual(["execute", "query", "subscribe"]);
  });

  it("Supertag Search is a bounded serialized query with stable cursors", async () => {
    const { serialized } = await setup();
    const setupResult = await serialized.execute({
      ...command,
      invocationId: "supertag-instances-setup",
      actions: [
        ...nodeAtWorkspace("anime", "supertag-definition"),
        ...["a", "b", "c", "d", "e"].flatMap((nodeId) => [
          ...nodeAtWorkspace(nodeId),
          createSupertagApplication(nodeId, "anime"),
        ]),
      ],
    });
    expect(setupResult.status).toBe("published");

    const first = await serialized.query({
      kind: "supertag-instances",
      workspaceId: "workspace",
      perspective: "origin",
      supertagId: "anime",
      limit: 2,
    });
    expect(first).toMatchObject({
      status: "ok",
      value: { perspective: "origin", supertagId: "anime", nodeIds: ["a", "b"], next: "b" },
    });
    if (first.status !== "ok" || !("nodeIds" in first.value)) {
      throw new Error("Expected Supertag Search result");
    }
    const second = await serialized.query({
      kind: "supertag-instances",
      workspaceId: "workspace",
      perspective: "origin",
      supertagId: "anime",
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
          invocationId: "delete-search-supertag",
          actions: [{ kind: "node-delete", nodeId: "anime" }],
        })
      ).status,
    ).toBe("published");
    const nodes = await serialized.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "nodes",
    });
    expect(nodes).toMatchObject({
      status: "ok",
      value: {
        nodes: {
          anime: {
            nodeId: "anime",
            intrinsicNodeType: "supertag-definition",
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
          actions: [
            nodeAt("note-supertag", "workspace", "note-supertag-original", "supertag-definition"),
            nodeAt("guidance", "workspace", "guidance-original"),
            nodeAt("note", "workspace", "note-occurrence"),
            {
              kind: "template-member-add",
              supertagId: "note-supertag",
              templateNodeId: "guidance",
              anchor: end,
            },
            createSupertagApplication("note", "note-supertag"),
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
          actions: [
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
        perspective: "origin",
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
    expect(
      (
        await serialized.execute({
          ...command,
          invocationId: "serialized-field-setup",
          actions: [
            nodeAt("owner", "workspace", "owner-occurrence"),
            nodeAt("supertag", "workspace", "supertag-original", "supertag-definition"),
            nodeAt("field-definition", "workspace", "field-definition-original", "field-definition"),
            nodeAt("field-node", "owner", "field-occurrence"),
            nodeAt("value", "field-node", "value-occurrence"),
            createSupertagApplication("owner", "supertag"),
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
    const valueDeletion = await serialized.execute({
      ...command,
      invocationId: "serialized-value-delete",
      actions: [
        {
          kind: "field-value-remove",
          valuePlacementId: "value-occurrence",
        },
      ],
    });
    expect(valueDeletion.status).toBe("published");
    expect(
      await serialized.query({
        kind: "projection",
        workspaceId: "workspace",
        perspective: "origin",
        section: "materializedFields",
      }),
    ).toMatchObject({
      status: "ok",
      value: { materializedFields: { owner: [{ valueOccurrenceIds: [] }] } },
    });
    expect(
      await serialized.query({
        kind: "projection",
        workspaceId: "workspace",
        perspective: "origin",
        section: "workspaceSystemNodes",
      }),
    ).toMatchObject({
      status: "ok",
      value: {
        workspaceSystemNodes: {
          trash: workspaceTrashNodeId("workspace"),
          systemDefinitionCatalog: SYSTEM_DEFINITION_CATALOG_NODE_ID,
        },
      },
    });
    expect(
      await serialized.query({
        kind: "projection",
        workspaceId: "workspace",
        perspective: "origin",
        section: "metanodes",
      }),
    ).toMatchObject({ status: "ok", value: { metanodes: {} } });
    expect(
      await serialized.execute({
        ...command,
        invocationId: "reject-open-field-delete-shape",
        actions: [
          {
            kind: "materialized-field-clear",
            ownerNodeId: "owner",
            fieldDefinitionId: "field-definition",
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
      actions: [{ kind: "node-delete", nodeId: "node" }],
    });
    if (deletion.status !== "published" || !deletion.receipt.factIds[0]) {
      throw new Error("Expected serialized deletion");
    }
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
    const deletionActionIds = preview.value.selection.deletionActionIds;

    expect(
      (
        await serialized.execute({
          kind: "acknowledge-deletion",
          workspaceId: "workspace",
          invocationId: "serialized-ack",
          actorId: "maintainer",
          nodeId: "node",
          deletionActionIds,
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

  it("wire and in-process invalid inputs reject before any authority record is written", async () => {
    const { direct, facts } = await setup();
    const initialFactIds = facts.snapshot().facts.map(({ id }) => id);
    expect(
      await direct.execute({
        ...command,
        invocationId: "bare-node-identity",
        actions: [{ kind: "node-create", nodeId: "bare", ownerNodeId: "workspace", originalPlacement: null }],
      } as never),
    ).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });
    const invalid = {
      ...command,
      invocationId: "",
      actions: [{ kind: "future-action", futureSemantic: true }],
    };
    expect(await direct.execute(invalid as never)).toMatchObject({
      status: "rejected",
      error: { code: "invalid-input" },
    });
    const server = createEngineTransportServer(direct);
    const wireInvalid = {
      ...command,
      invocationId: "",
      actions: [{ kind: "node-delete", nodeId: "node" }],
    } as const;
    const response = decodeWriteResult(await server.execute(encodeEngineCommand(wireInvalid)));
    expect(response).toMatchObject({
      status: "rejected",
      error: { code: "invalid-input" },
    });
    const invalidQuery = {
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      limit: 0,
    } as const;
    expect(decodeEngineQueryResult(await server.query(encodeEngineQuery(invalidQuery)), invalidQuery)).toMatchObject({
      status: "rejected",
      error: { code: "invalid-input" },
    });
    expect(facts.snapshot().facts.map(({ id }) => id)).toEqual(initialFactIds);
    expect(facts.receipts()).toHaveLength(1);
  });

  it("pre-send encoding failures and raw malformed envelopes are typed invalid input", async () => {
    const { direct, serialized, facts } = await setup();
    const initialFactIds = facts.snapshot().facts.map(({ id }) => id);
    const invalid = {
      ...command,
      actions: [
        {
          kind: "node-create",
          nodeId: "invalid",
          seed: { text: [{ value: "invalid", attributes: { bigint: 1n } }] },
        },
      ],
    };
    expect(await direct.execute(invalid as never)).toMatchObject({
      status: "rejected",
      error: { code: "invalid-input" },
    });
    expect(await serialized.execute(invalid as never)).toMatchObject({
      status: "rejected",
      error: { code: "invalid-input" },
    });

    const server = createEngineTransportServer(direct);
    for (const malformedBytes of [new Uint8Array(), new Uint8Array([0xff])]) {
      const response = decodeWriteResult(await server.execute(malformedBytes));
      expect(response).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });
    }
    expect(facts.snapshot().facts.map(({ id }) => id)).toEqual(initialFactIds);
    expect(facts.receipts()).toHaveLength(1);
  });

  it("Command outcome unknown", async () => {
    const { direct } = await setup();
    const server = createEngineTransportServer(direct);
    let loseResponse = true;
    const lossy: EngineTransport = {
      async execute(bytes) {
        const result = await server.execute(bytes);
        if (loseResponse) {
          loseResponse = false;
          throw new Error("response lost after execution");
        }
        return result;
      },
      query: (bytes) => server.query(bytes),
      subscribe: server.subscribe,
    };
    const adapter = createTransportEngineApplication(lossy);
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
      execute: () => Promise.resolve(new Uint8Array([0xff])),
      query: () => Promise.resolve(new Uint8Array([0xff])),
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const adapter = createTransportEngineApplication(malformed);
    expect(await adapter.execute(command)).toEqual({
      status: "outcome-unknown",
      invocationId: command.invocationId,
    });
    expect(
      await adapter.query({
        kind: "projection",
        workspaceId: "workspace",
        perspective: "origin",
      }),
    ).toMatchObject({ status: "rejected", error: { code: "projection-unavailable" } });
    let delivered = 0;
    adapter.subscribe(() => {
      delivered += 1;
    });
    for (const listener of listeners) {
      listener(new Uint8Array([0xff]));
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
    expect(events.every((event) => typeof event === "object" && event !== null && !Object.hasOwn(event, "facts"))).toBe(
      true,
    );
    const first = await serialized.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
    });
    const second = await serialized.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
    });
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});
