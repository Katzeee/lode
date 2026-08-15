import { describe, expect, it } from "vitest";

import type { ProjectionPage } from "@lode/sdk";
import { admitAuthorityRecords } from "../../domain/admission/index.js";
import type { EditMutation } from "../../domain/edit/index.js";
import { templateInstanceNodeId, templateInstanceOccurrenceId, type ViewMode } from "../../domain/fact/index.js";
import { InMemoryDocumentStore } from "../../persistence/in-memory-document-store.js";
import { createReplicaId, FactAuthorityStore } from "../authority/fact-authority-store.js";
import { ProposalWorkspace } from "./proposal-workspace.js";

const versions = { rulesVersion: "proposal-rules-5", schemaVersion: "lode-schema-19" } as const;
const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("ordinary Schema Template Nodes", () => {
  it("projects Template content onto the Workspace Node", async () => {
    const opened = await open(new InMemoryDocumentStore(), "299");
    expect(
      (
        await mutate(opened, "workspace-template", [
          {
            kind: "node-create",
            occurrenceId: "workspace-schema-original",
            nodeId: "workspace-schema",
            parentNodeId: "workspace",
            anchor: end,
            nodeType: "schema",
          },
          {
            kind: "node-create",
            nodeId: "workspace-guidance",
            occurrenceId: "workspace-guidance-template-occurrence",
            parentNodeId: "workspace-schema",
            anchor: end,
          },
          {
            kind: "schema-template-node-add",
            schemaId: "workspace-schema",
            templateNodeId: "workspace-guidance",
            templateOccurrenceId: "workspace-guidance-template-occurrence",
            anchor: end,
          },
          {
            kind: "schema-apply",
            nodeId: "workspace",
            schemaId: "workspace-schema",
            anchor: end,
          },
        ])
      ).status,
    ).toBe("published");

    expect(await templateInstance(opened, "origin")).toMatchObject({
      ownerNodeId: "workspace",
      templateNodeId: "workspace-guidance",
      instanceNodeId: null,
      state: "linked",
    });
    expect(await occurrenceNode(opened, templateInstanceOccurrenceId("workspace", "workspace-guidance"))).toBe(
      "workspace-guidance",
    );
  });

  it("trashes a detached Node when its Original is deleted and restores the same identity", async () => {
    const opened = await open(new InMemoryDocumentStore(), "300");
    expect((await mutate(opened, "lifecycle-setup", setupProgram())).status).toBe("published");
    const instanceNodeId = templateInstanceNodeId("note", "guidance");
    const instanceOccurrenceId = templateInstanceOccurrenceId("note", "guidance");
    expect(
      (
        await mutate(opened, "lifecycle-detach", [
          {
            kind: "template-node-detach",
            ownerNodeId: "note",
            templateNodeId: "guidance",
            instanceNodeId,
            instanceOccurrenceId,
            anchor: end,
          },
        ])
      ).status,
    ).toBe("published");

    const deletion = await mutate(opened, "delete-detached-original", [
      { kind: "occurrence-delete", occurrenceId: instanceOccurrenceId },
    ]);
    if (deletion.status !== "published") {
      throw new Error(`Expected detached Original deletion to publish: ${JSON.stringify(deletion)}`);
    }
    const deletionFactId = deletion.receipt.factIds[0];
    if (!deletionFactId) {
      throw new Error("Expected detached Node deletion Fact");
    }
    expect(await occurrenceNode(opened, instanceOccurrenceId)).toBeUndefined();
    expect(await nodeText(opened, instanceNodeId)).toBe("");
    expect(
      (
        await mutate(opened, "restore-detached-node", [
          {
            kind: "node-restore",
            nodeId: instanceNodeId,
            deletionFactId,
          },
        ])
      ).status,
    ).toBe("published");
    expect(await nodeText(opened, instanceNodeId)).toBe("Guidance");
    expect(await occurrenceNode(opened, instanceOccurrenceId)).toBe(instanceNodeId);
  });

  it("follows the definition until detach, then preserves instance identity and content", async () => {
    const documents = new InMemoryDocumentStore();
    const first = await open(documents, "301");
    expect((await mutate(first, "setup", setupProgram())).status).toBe("published");

    const templateOccurrenceId = "note-schema-guidance-template-occurrence";
    const templateOccurrence = (await section(first, "origin", "occurrences")).occurrences[templateOccurrenceId];
    expect(templateOccurrence).toMatchObject({
      occurrenceId: templateOccurrenceId,
      nodeId: "guidance",
      parentNodeId: "note-schema",
      derived: false,
    });
    expect((await section(first, "origin", "children")).children["note-schema"]).toContain(templateOccurrenceId);
    expect((await section(first, "origin", "nodeOwners")).nodeOwners.guidance).toBe("note-schema");

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
          templateOccurrenceId: "note-schema-guidance-template-occurrence",
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
          {
            kind: "template-node-detach",
            ownerNodeId: "note",
            templateNodeId: "guidance",
            instanceNodeId: detachedNodeId,
            instanceOccurrenceId: linked.instanceOccurrenceId,
            anchor: end,
          },
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

  it("keeps a Template Occurrence as a Reference when the Node is owned elsewhere", async () => {
    const opened = await open(new InMemoryDocumentStore(), "351");
    const program = setupProgram().flatMap((mutation): readonly EditMutation[] =>
      mutation.kind === "node-create" && mutation.nodeId === "guidance"
        ? [
            {
              kind: "node-create",
              occurrenceId: "guidance-original-occurrence",
              nodeId: "guidance",
              parentNodeId: "workspace",
              anchor: end,
            },
          ]
        : [mutation],
    );
    expect((await mutate(opened, "reference-template", program)).status).toBe("published");

    const occurrences = (await section(opened, "origin", "occurrences")).occurrences;
    expect(occurrences["guidance-original-occurrence"]?.nodeId).toBe("guidance");
    expect(occurrences["note-schema-guidance-template-occurrence"]).toMatchObject({
      nodeId: "guidance",
      parentNodeId: "note-schema",
    });
    expect((await section(opened, "origin", "nodeOwners")).nodeOwners.guidance).toBe("workspace");
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
            {
              kind: "template-node-detach",
              ownerNodeId: "note",
              templateNodeId: "guidance",
              instanceNodeId,
              instanceOccurrenceId: templateInstanceOccurrenceId("note", "guidance"),
              anchor: end,
            },
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
      (hunk) => hunk.diffSpace.kind === "node-content" && hunk.diffSpace.identity === instanceNodeId,
    );
    if (!textHunk) {
      throw new Error("Expected detached instance text Hunk");
    }
    expect(textHunk.selection.evidence.supportClosure).toEqual(textHunk.selection.evidence.proposalTargets);
    const acceptedDetachment = await opened.workspace.execute({
      kind: "resolve-review",
      workspaceId: "workspace",
      invocationId: "accept-detached-text",
      actorId: "reviewer",
      decision: "accept",
      selection: textHunk.selection,
    });
    expect(acceptedDetachment.status).toBe("published");
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
          {
            kind: "node-create",
            occurrenceId: "derived-schema-original",
            nodeId: "derived-schema",
            parentNodeId: "workspace",
            anchor: end,
            nodeType: "schema",
          },
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
        templateOccurrenceId: "note-schema-guidance-template-occurrence",
      },
      {
        schemaId: "note-schema",
        appliedSchemaId: "derived-schema",
        templateOccurrenceId: "note-schema-guidance-template-occurrence",
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

function setupProgram(): readonly EditMutation[] {
  return [
    {
      kind: "node-create",
      occurrenceId: "note-schema-original",
      nodeId: "note-schema",
      parentNodeId: "workspace",
      anchor: end,
      nodeType: "schema",
    },
    {
      kind: "node-create",
      nodeId: "guidance",
      occurrenceId: "note-schema-guidance-template-occurrence",
      parentNodeId: "note-schema",
      anchor: end,
    },
    {
      kind: "node-create",
      occurrenceId: "note-occurrence",
      nodeId: "note",
      parentNodeId: "workspace",
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
      templateOccurrenceId: "note-schema-guidance-template-occurrence",
      anchor: end,
    },
    { kind: "schema-apply", nodeId: "note", schemaId: "note-schema", anchor: end },
  ];
}

async function mutate(
  opened: Awaited<ReturnType<typeof open>>,
  invocationId: string,
  mutations: readonly EditMutation[],
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
  const facts = await FactAuthorityStore.open({
    workspaceId: "workspace",
    replicaId: createReplicaId(),
    loroPeerId,
    documents,
    admitRecords: admitAuthorityRecords,
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
