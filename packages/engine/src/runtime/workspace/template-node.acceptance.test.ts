import { describe, expect, it } from "vitest";

import type { ProjectionPage } from "../../application/contract.js";
import type { Mutation, ViewMode } from "../../domain/fact/index.js";
import {
  templateInstanceNodeId,
  templateInstanceOccurrenceId,
} from "../../domain/reconcile/index.js";
import { InMemoryDocumentStore } from "../../persistence/in-memory-document-store.js";
import { createReplicaId, LoroFactStore } from "../authority/loro-fact-store.js";
import { ProposalWorkspace } from "./proposal-workspace.js";

const versions = { rulesVersion: "proposal-rules-1", schemaVersion: "lode-schema-12" } as const;
const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("ordinary Schema Template Nodes", () => {
  it("follows the definition until detach, then preserves instance identity and content", async () => {
    const documents = new InMemoryDocumentStore();
    const first = await open(documents, "301");
    expect((await mutate(first, "setup", setupProgram())).status).toBe("published");

    const linked = await templateInstance(first, "origin");
    expect(linked).toMatchObject({
      ownerNodeId: "note",
      templateNodeId: "guidance",
      instanceNodeId: null,
      instanceOccurrenceId: templateInstanceOccurrenceId("note", "guidance"),
      state: "linked",
      sources: [
        {
          schemaId: "note-schema",
          appliedSchemaId: "note-schema",
          templateItemId: "node-template:v1:note-schema:guidance",
        },
      ],
    });
    expect(await occurrenceNode(first, linked.instanceOccurrenceId)).toBe("guidance");
    expect(await nodeText(first, "guidance")).toBe("Guidance");

    expect(
      (
        await mutate(first, "evolve-template", [
          {
            kind: "text-splice",
            nodeId: "guidance",
            deleteAtomIds: [],
            anchor: end,
            insert: " v2",
          },
        ])
      ).status,
    ).toBe("published");
    expect(await nodeText(first, "guidance")).toBe("Guidance v2");
    expect(await occurrenceNode(first, linked.instanceOccurrenceId)).toBe("guidance");

    const detachedNodeId = templateInstanceNodeId("note", "guidance");
    expect(
      (
        await mutate(first, "detach-and-edit", [
          { kind: "template-node-detach", ownerNodeId: "note", templateNodeId: "guidance" },
          {
            kind: "text-splice",
            nodeId: detachedNodeId,
            deleteAtomIds: [],
            anchor: end,
            insert: " — local",
          },
        ])
      ).status,
    ).toBe("published");
    expect(await templateInstance(first, "origin")).toMatchObject({
      state: "detached",
      instanceNodeId: detachedNodeId,
      instanceOccurrenceId: linked.instanceOccurrenceId,
    });
    expect(await nodeText(first, detachedNodeId)).toBe("Guidance v2 — local");

    expect(
      (
        await mutate(first, "evolve-after-detach", [
          {
            kind: "text-splice",
            nodeId: "guidance",
            deleteAtomIds: [],
            anchor: end,
            insert: " upstream",
          },
          { kind: "schema-remove", nodeId: "note", schemaId: "note-schema" },
        ])
      ).status,
    ).toBe("published");
    expect(await nodeText(first, "guidance")).toBe("Guidance v2 upstream");
    expect(await nodeText(first, detachedNodeId)).toBe("Guidance v2 — local");
    expect(await templateInstance(first, "origin")).toMatchObject({
      state: "detached",
      sources: [
        {
          schemaId: "note-schema",
          appliedSchemaId: "note-schema",
        },
      ],
    });

    await first.workspace.close();
    const restarted = await open(documents, "302");
    expect(await nodeText(restarted, detachedNodeId)).toBe("Guidance v2 — local");
    expect(await occurrenceNode(restarted, linked.instanceOccurrenceId)).toBe(detachedNodeId);
  });

  it("keeps Proposal detachment out of Origin and accepts its edit through support closure", async () => {
    const opened = await open(new InMemoryDocumentStore(), "401");
    expect((await mutate(opened, "proposal-setup", setupProgram())).status).toBe("published");
    const instanceNodeId = templateInstanceNodeId("note", "guidance");
    expect(
      (
        await mutate(
          opened,
          "propose-detachment",
          [
            { kind: "template-node-detach", ownerNodeId: "note", templateNodeId: "guidance" },
            {
              kind: "text-splice",
              nodeId: instanceNodeId,
              deleteAtomIds: [],
              anchor: end,
              insert: " locally",
            },
          ],
          "proposal",
        )
      ).status,
    ).toBe("published");

    expect(await templateInstance(opened, "origin")).toMatchObject({ state: "linked" });
    expect(await templateInstance(opened, "review")).toMatchObject({
      state: "detached",
      instanceNodeId,
    });
    expect(await nodeText(opened, instanceNodeId, "review")).toBe("Guidance locally");
    expect(await nodeText(opened, instanceNodeId, "origin")).toBe("");

    const review = await opened.workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in review)) {
      throw new Error("Expected Template Node Review Hunks");
    }
    const textHunk = review.hunks.find(
      (hunk) =>
        hunk.diffSpace.kind === "node-content" && hunk.diffSpace.identity === instanceNodeId,
    );
    if (!textHunk) {
      throw new Error("Expected detached instance text Hunk");
    }
    expect(textHunk.selection.evidence.supportClosure.length).toBeGreaterThan(
      textHunk.selection.evidence.proposalTargets.length,
    );
    expect(
      (
        await opened.workspace.execute({
          kind: "resolve-review",
          workspaceId: "workspace",
          invocationId: "accept-detached-text",
          actorId: "reviewer",
          decision: "accept",
          selection: textHunk.selection,
        })
      ).status,
    ).toBe("published");
    expect(await templateInstance(opened, "origin")).toMatchObject({
      state: "detached",
      instanceNodeId,
    });
    expect(await nodeText(opened, instanceNodeId)).toBe("Guidance locally");
  });

  it("preserves Extension and multiple-application provenance without duplicate occurrences", async () => {
    const opened = await open(new InMemoryDocumentStore(), "501");
    expect(
      (
        await mutate(opened, "provenance-setup", [
          ...setupProgram(),
          { kind: "node-create", nodeId: "derived-schema" },
          {
            kind: "schema-extension-add",
            schemaId: "derived-schema",
            baseSchemaId: "note-schema",
            anchor: end,
          },
          { kind: "schema-apply", nodeId: "note", schemaId: "derived-schema", anchor: end },
        ])
      ).status,
    ).toBe("published");
    const instances = await templateInstances(opened, "origin");
    expect(instances).toHaveLength(1);
    expect(instances[0]?.sources).toEqual([
      {
        schemaId: "note-schema",
        appliedSchemaId: "note-schema",
        templateItemId: "node-template:v1:note-schema:guidance",
      },
      {
        schemaId: "note-schema",
        appliedSchemaId: "derived-schema",
        templateItemId: "node-template:v1:note-schema:guidance",
      },
    ]);
    const occurrenceId = templateInstanceOccurrenceId("note", "guidance");
    const children = await section(opened, "origin", "children");
    expect(
      Object.values(children.children)
        .flat()
        .filter((candidate) => candidate === occurrenceId),
    ).toEqual([occurrenceId]);
  });
});

function setupProgram(): readonly Mutation[] {
  return [
    { kind: "node-create", nodeId: "note-schema" },
    { kind: "node-create", nodeId: "guidance" },
    { kind: "node-create", nodeId: "note" },
    {
      kind: "occurrence-create",
      occurrenceId: "note-occurrence",
      nodeId: "note",
      parentOccurrenceId: null,
      parentPolicy: "cascade",
      anchor: end,
    },
    {
      kind: "text-splice",
      nodeId: "guidance",
      deleteAtomIds: [],
      anchor: end,
      insert: "Guidance",
    },
    {
      kind: "schema-template-node-add",
      schemaId: "note-schema",
      templateNodeId: "guidance",
      anchor: end,
    },
    { kind: "schema-apply", nodeId: "note", schemaId: "note-schema", anchor: end },
  ];
}

async function mutate(
  opened: Awaited<ReturnType<typeof open>>,
  invocationId: string,
  mutations: readonly Mutation[],
  intent: "direct" | "proposal" = "direct",
) {
  return opened.workspace.execute({
    kind: "mutate",
    workspaceId: "workspace",
    invocationId,
    actorId: "actor",
    intent,
    historyChannelId: "desktop",
    mutations,
  });
}

async function open(documents: InMemoryDocumentStore, loroPeerId: `${number}`) {
  const facts = await LoroFactStore.open({
    workspaceId: "workspace",
    replicaId: createReplicaId(),
    loroPeerId,
    documents,
  });
  return {
    facts,
    workspace: await ProposalWorkspace.open({ workspaceId: "workspace", facts, versions }),
  };
}

async function templateInstance(opened: Awaited<ReturnType<typeof open>>, view: ViewMode) {
  const instances = await templateInstances(opened, view);
  const instance = instances[0];
  if (!instance) {
    throw new Error(`Expected a ${view} Template Node instance`);
  }
  return instance;
}

async function templateInstances(opened: Awaited<ReturnType<typeof open>>, view: ViewMode) {
  const page = await section(opened, view, "templateNodeInstances");
  return page.templateNodeInstances;
}

async function nodeText(
  opened: Awaited<ReturnType<typeof open>>,
  nodeId: string,
  view: ViewMode = "origin",
): Promise<string> {
  const page = await section(opened, view, "nodes");
  return page.nodes[nodeId]?.text.map((atom) => atom.value).join("") ?? "";
}

async function occurrenceNode(
  opened: Awaited<ReturnType<typeof open>>,
  occurrenceId: string,
): Promise<string | undefined> {
  const page = await section(opened, "origin", "occurrences");
  return page.occurrences[occurrenceId]?.nodeId;
}

async function section<S extends ProjectionPage["section"]>(
  opened: Awaited<ReturnType<typeof open>>,
  view: ViewMode,
  requested: S,
): Promise<ProjectionPage & Readonly<{ section: S }>> {
  const result = await opened.workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    view,
    section: requested,
  });
  if (!("section" in result) || result.section !== requested) {
    throw new Error(`Expected ${requested} Projection`);
  }
  return result as ProjectionPage & Readonly<{ section: S }>;
}
