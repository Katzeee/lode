import { describe, expect, it } from "vitest";

import {
  createEngineTransportServer,
  createTransportEngineContract,
} from "../../application/transport.js";
import type { EngineContract, EngineQueryValue } from "../../application/contract.js";
import { admitAuthorityRecords } from "../../domain/admission/index.js";
import type { EditMutation } from "../../domain/edit/index.js";
import {
  VIEW_FIELDS_PROPERTY,
  VIEW_LAYOUT_PROPERTY,
  VIEW_SCHEMA_PROPERTY,
  type ViewResult,
} from "../../domain/view/index.js";
import { InMemoryDocumentStore } from "../../persistence/in-memory-document-store.js";
import { createReplicaId, FactAuthorityStore } from "../authority/fact-authority-store.js";
import { BoundedProjectionMaterializer } from "../materialization/index.js";
import { ProposalWorkspace } from "./proposal-workspace.js";
import { ProposalWorkspaceRegistry } from "./proposal-registry.js";

const versions = { rulesVersion: "proposal-rules-5", schemaVersion: "lode-schema-19" } as const;
const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("persistent View Nodes", () => {
  it("presents polymorphic Schema members and Field identities through Origin, Review, and restart", async () => {
    const documents = new InMemoryDocumentStore();
    const opened = await open(documents, "901");
    expect((await mutate(opened.contract, "setup-view", viewProgram())).status).toBe("published");

    const origin = await view(opened.contract, "origin");
    expect(origin).toMatchObject({
      viewNodeId: "anime-view",
      schemaId: "anime",
      layout: "table",
      fieldDefinitionIds: ["work-field", "status-field"],
      rows: [
        {
          nodeId: "row-a",
          text: "Quick note",
          fields: [
            {
              fieldDefinitionId: "work-field",
              state: "materialized",
              fieldNodeId: "row-a-work-field",
              fieldOccurrenceId: "row-a-work-occurrence",
              valueOccurrenceIds: ["row-a-work-reference"],
              valueNodeIds: ["frieren"],
            },
            { fieldDefinitionId: "status-field", state: "placeholder" },
          ],
        },
        {
          nodeId: "row-b",
          text: "Review note",
          fields: [
            { fieldDefinitionId: "work-field", state: "placeholder" },
            { fieldDefinitionId: "status-field", state: "placeholder" },
          ],
        },
      ],
    });

    expect(
      (
        await mutate(
          opened.contract,
          "propose-view-columns",
          [viewProperty(VIEW_FIELDS_PROPERTY, ["work-field"])],
          "proposal",
        )
      ).status,
    ).toBe("published");
    expect((await view(opened.contract, "origin")).fieldDefinitionIds).toEqual([
      "work-field",
      "status-field",
    ]);
    expect((await view(opened.contract, "review")).fieldDefinitionIds).toEqual(["work-field"]);
    await resolveHunk(opened.contract, "value", "reject", "reject-view-columns");
    expect((await view(opened.contract, "review")).fieldDefinitionIds).toEqual([
      "work-field",
      "status-field",
    ]);

    expect(
      (
        await mutate(
          opened.contract,
          "propose-view-member",
          [{ kind: "schema-apply", nodeId: "row-c", schemaId: "anime", anchor: end }],
          "proposal",
        )
      ).status,
    ).toBe("published");
    expect((await view(opened.contract, "origin")).rows.map((row) => row.nodeId)).toEqual([
      "row-a",
      "row-b",
    ]);
    const reviewBeforeAccept = await view(opened.contract, "review");
    expect(reviewBeforeAccept.rows.map((row) => row.nodeId)).toEqual(["row-a", "row-b", "row-c"]);
    await resolveHunk(opened.contract, "schema-application", "accept", "accept-view-member");
    expect((await view(opened.contract, "origin")).rows).toEqual(reviewBeforeAccept.rows);

    await opened.workspace.close();
    const restarted = await open(documents, "902");
    expect((await view(restarted.contract, "origin")).rows.map((row) => row.nodeId)).toEqual([
      "row-a",
      "row-b",
      "row-c",
    ]);
  });

  it("paginates View rows and excludes unrelated entities", async () => {
    const opened = await open(new InMemoryDocumentStore(), "903", 16);
    const members = Array.from(
      { length: 50 },
      (_, index) => `member-${String(index).padStart(3, "0")}`,
    );
    const unrelated = ["unrelated"];
    expect(
      (
        await mutate(opened.contract, "bounded-view-setup", [
          ...nodeAtWorkspace("bounded-view"),
          {
            kind: "node-type-declare",
            nodeId: "bounded-view",
            nodeType: "view",
          },
          ...nodeAtWorkspace("bounded-schema"),
          {
            kind: "node-type-declare",
            nodeId: "bounded-schema",
            nodeType: "schema",
          },
          viewProperty(VIEW_SCHEMA_PROPERTY, "bounded-schema", "bounded-view"),
          viewProperty(VIEW_LAYOUT_PROPERTY, "cards", "bounded-view"),
          viewProperty(VIEW_FIELDS_PROPERTY, [], "bounded-view"),
          ...[...members, ...unrelated].flatMap(nodeAtWorkspace),
          ...members.map((nodeId): EditMutation => ({
            kind: "schema-apply",
            nodeId,
            schemaId: "bounded-schema",
            anchor: end,
          })),
        ])
      ).status,
    ).toBe("published");
    const first = await view(opened.contract, "origin", null, 25, "bounded-view");
    expect(first.rows).toHaveLength(25);
    expect(first.next).toBe("member-024");
    const second = await view(opened.contract, "origin", first.next, 25, "bounded-view");
    expect(second.rows[0]?.nodeId).toBe("member-025");
    expect(second.rows.some((row) => row.nodeId.startsWith("unrelated-"))).toBe(false);
    expect(
      await opened.contract.query({
        kind: "view",
        workspaceId: "workspace",
        view: "origin",
        viewNodeId: "bounded-view",
        limit: 25,
        unknown: true,
      } as never),
    ).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });
  });

  it("does not infer a View Configuration from magic properties", async () => {
    const opened = await open(new InMemoryDocumentStore(), "904");
    expect(
      (
        await mutate(opened.contract, "plain-node-with-view-properties", [
          ...nodeAtWorkspace("plain-view"),
          viewProperty(VIEW_SCHEMA_PROPERTY, "schema", "plain-view"),
          viewProperty(VIEW_LAYOUT_PROPERTY, "table", "plain-view"),
          viewProperty(VIEW_FIELDS_PROPERTY, [], "plain-view"),
        ])
      ).status,
    ).toBe("published");

    expect(
      await opened.contract.query({
        kind: "view",
        workspaceId: "workspace",
        view: "origin",
        viewNodeId: "plain-view",
        after: null,
        limit: 25,
      }),
    ).toMatchObject({
      status: "rejected",
      error: { message: "View type is absent" },
    });
  });
});

function viewProgram(): readonly EditMutation[] {
  return [
    ...["anime-view", "anime", "review", "work-field", "status-field", "row-c"].flatMap(
      nodeAtWorkspace,
    ),
    {
      kind: "node-type-declare",
      nodeId: "anime-view",
      nodeType: "view",
    },
    { kind: "node-type-declare", nodeId: "anime", nodeType: "schema" },
    { kind: "node-type-declare", nodeId: "review", nodeType: "schema" },
    { kind: "node-type-declare", nodeId: "work-field", nodeType: "field-definition" },
    { kind: "node-type-declare", nodeId: "status-field", nodeType: "field-definition" },
    {
      kind: "node-create",
      nodeId: "outline-root",
      occurrenceId: "outline-root-occurrence",
      parentNodeId: "workspace",
      anchor: end,
    },
    {
      kind: "node-create",
      nodeId: "row-a",
      occurrenceId: "row-a-occurrence",
      parentNodeId: "outline-root",
      anchor: end,
    },
    {
      kind: "node-create",
      nodeId: "row-b",
      occurrenceId: "row-b-occurrence",
      parentNodeId: "outline-root",
      anchor: end,
    },
    {
      kind: "node-create",
      nodeId: "row-a-work-field",
      occurrenceId: "row-a-work-occurrence",
      parentNodeId: "row-a",
      anchor: end,
    },
    {
      kind: "node-create",
      nodeId: "frieren",
      occurrenceId: "row-a-work-reference",
      parentNodeId: "row-a-work-field",
      anchor: end,
    },
    viewProperty(VIEW_SCHEMA_PROPERTY, "anime"),
    viewProperty(VIEW_LAYOUT_PROPERTY, "table"),
    viewProperty(VIEW_FIELDS_PROPERTY, ["work-field", "status-field"]),
    text("row-a", "Quick note"),
    text("row-b", "Review note"),
    {
      kind: "schema-field-add",
      schemaId: "anime",
      fieldDefinitionId: "work-field",
      fieldNodeId: "anime-work-field-template-field",
      fieldOccurrenceId: "anime-work-field-template-field-occurrence",
      anchor: end,
    },
    {
      kind: "schema-field-add",
      schemaId: "anime",
      fieldDefinitionId: "status-field",
      fieldNodeId: "anime-status-field-template-field",
      fieldOccurrenceId: "anime-status-field-template-field-occurrence",
      anchor: end,
    },
    { kind: "schema-extension-add", schemaId: "review", baseSchemaId: "anime", anchor: end },
    { kind: "schema-apply", nodeId: "row-a", schemaId: "anime", anchor: end },
    { kind: "schema-apply", nodeId: "row-b", schemaId: "review", anchor: end },
    {
      kind: "field-materialize",
      ownerNodeId: "row-a",
      fieldDefinitionId: "work-field",
      fieldNodeId: "row-a-work-field",
      fieldOccurrenceId: "row-a-work-occurrence",
    },
  ];
}

function viewProperty(key: string, value: string | string[], nodeId = "anime-view"): EditMutation {
  return {
    kind: "value-set",
    target: { kind: "node", id: nodeId },
    namespace: "property",
    key,
    value,
  };
}

function nodeAtWorkspace(nodeId: string): readonly EditMutation[] {
  return [
    {
      kind: "node-create",
      nodeId,
      occurrenceId: `${nodeId}-original`,
      parentNodeId: "workspace",
      anchor: end,
    },
  ];
}

function text(nodeId: string, insert: string): EditMutation {
  return { kind: "text-splice", nodeId, deleteAtomIds: [], anchor: end, insert };
}

async function open(documents: InMemoryDocumentStore, loroPeerId: `${number}`, capacity = 128) {
  const facts = await FactAuthorityStore.open({
    workspaceId: "workspace",
    replicaId: createReplicaId(),
    loroPeerId,
    documents,
    admitRecords: admitAuthorityRecords,
  });
  const materializer = new BoundedProjectionMaterializer(documents, { capacity });
  const workspace = await ProposalWorkspace.open({
    workspaceId: "workspace",
    facts,
    versions,
    projection: { projections: materializer },
  });
  const registry = new ProposalWorkspaceRegistry();
  registry.register(workspace);
  return {
    workspace,
    materializer,
    contract: createTransportEngineContract(createEngineTransportServer(registry.contract)),
  };
}

async function mutate(
  contract: EngineContract,
  invocationId: string,
  mutations: readonly EditMutation[],
  intent: "direct" | "proposal" = "direct",
) {
  return contract.execute({
    kind: "mutate",
    workspaceId: "workspace",
    invocationId,
    actorId: "actor",
    intent,
    historyChannelId: "desktop",
    mutations,
  });
}

async function resolveHunk(
  contract: EngineContract,
  diffKind: string,
  decision: "accept" | "reject",
  invocationId: string,
): Promise<void> {
  const review = await query(contract, { kind: "review", workspaceId: "workspace" });
  if (!("hunks" in review)) {
    throw new Error("Expected Review query");
  }
  const hunk = review.hunks.find((candidate) => candidate.diffSpace.kind === diffKind);
  if (!hunk) {
    throw new Error(`Expected ${diffKind} Review Hunk`);
  }
  expect(
    (
      await contract.execute({
        kind: "resolve-review",
        workspaceId: "workspace",
        invocationId,
        actorId: "reviewer",
        decision,
        selection: hunk.selection,
      })
    ).status,
  ).toBe("published");
}

async function view(
  contract: EngineContract,
  projectionView: "origin" | "review",
  after: string | null = null,
  limit = 50,
  viewNodeId = "anime-view",
): Promise<ViewResult> {
  const value = await query(contract, {
    kind: "view",
    workspaceId: "workspace",
    view: projectionView,
    viewNodeId,
    after,
    limit,
  });
  if (!("rows" in value)) {
    throw new Error("Expected View result");
  }
  return value;
}

async function query(
  contract: EngineContract,
  request: Parameters<EngineContract["query"]>[0],
): Promise<EngineQueryValue> {
  const result = await contract.query(request);
  if (result.status !== "ok") {
    throw new Error(result.error.message);
  }
  return result.value;
}
