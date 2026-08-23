import { describe, expect, it } from "vitest";

import type { ProjectionPage } from "@lode/sdk";
import type { EditAction } from "../../domain/edit/index.js";
import {
  templateInstanceNodeId,
  templateInstanceOccurrenceId,
  workspaceTrashNodeId,
  type ProjectionPerspective,
} from "../../domain/fact/index.js";
import { InMemoryDocumentStore } from "../persistence/in-memory-document-store.js";
import { FactAuthority } from "./authority/fact-authority.js";
import { Workspace } from "./workspace.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import {
  createSupertagApplication,
  removeSupertagApplication,
} from "../../../tests/support/workspace/edit-test-actions.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("ordinary Supertag Template Nodes", () => {
  it("projects Template content onto the Workspace Node", async () => {
    const opened = await open(new InMemoryDocumentStore(), "299");
    expect(
      (
        await mutate(opened, "workspace-template", [
          {
            kind: "node-create",
            occurrenceId: "workspace-supertag-original",
            nodeId: "workspace-supertag",
            parentNodeId: "workspace",
            anchor: end,
            intrinsicNodeType: "supertag-definition",
          },
          {
            kind: "node-create",
            occurrenceId: "workspace-template-library-original",
            nodeId: "workspace-template-library",
            parentNodeId: "workspace",
            anchor: end,
          },
          {
            kind: "node-create",
            nodeId: "workspace-guidance",
            occurrenceId: "workspace-guidance-original",
            parentNodeId: "workspace-template-library",
            anchor: end,
          },
          {
            kind: "template-member-add",
            supertagId: "workspace-supertag",
            templateNodeId: "workspace-guidance",
            anchor: end,
          },
          createSupertagApplication("workspace", "workspace-supertag"),
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
    expect(await occurrenceParent(opened, instanceOccurrenceId)).toBe(workspaceTrashNodeId("workspace"));
    expect(await nodeText(opened, instanceNodeId)).toBe("Guidance");
    expect(
      (
        await mutate(opened, "restore-detached-node", [
          {
            kind: "node-restore",
            nodeId: instanceNodeId,
            occurrenceId: instanceOccurrenceId,
            parentNodeId: "note",
            anchor: end,
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

    const occurrences = (await section(first, "origin", "occurrences")).occurrences;
    const templateOccurrenceId = (await section(first, "origin", "childOccurrences")).childOccurrences[
      "note-supertag"
    ]?.find((occurrenceId) => occurrences[occurrenceId]?.nodeId === "guidance");
    if (!templateOccurrenceId) {
      throw new Error("Expected projected Template member Occurrence");
    }
    const templateOccurrence = occurrences[templateOccurrenceId];
    expect(templateOccurrence).toMatchObject({
      occurrenceId: templateOccurrenceId,
      nodeId: "guidance",
      parentNodeId: "note-supertag",
      derived: true,
    });
    expect((await section(first, "origin", "childOccurrences")).childOccurrences["note-supertag"]).toContain(
      templateOccurrenceId,
    );
    expect((await section(first, "origin", "nodeOwners")).nodeOwners.guidance).toBe("workspace");

    const linked = await templateInstance(first, "origin");
    expect(linked).toMatchObject({
      ownerNodeId: "note",
      templateNodeId: "guidance",
      instanceNodeId: null,
      instanceOccurrenceId: templateInstanceOccurrenceId("note", "guidance"),
      state: "linked",
      sources: [
        {
          supertagId: "note-supertag",
          appliedSupertagId: "note-supertag",
          templateOccurrenceId,
        },
      ],
    });
    expect(await occurrenceNode(first, linked.instanceOccurrenceId)).toBe("guidance");
    expect(await nodeText(first, "guidance")).toBe("Guidance");

    expect(
      (
        await mutate(first, "evolve-template", [
          {
            kind: "rich-text-splice",
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
            kind: "rich-text-splice",
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

    const evolved = await mutate(first, "evolve-after-detach", [
      {
        kind: "rich-text-splice",
        nodeId: "guidance",
        deleteAtomIds: [],
        anchor: end,
        insert: " upstream",
      },
      removeSupertagApplication("note", "note-supertag"),
    ]);
    expect(evolved, JSON.stringify(evolved)).toMatchObject({ status: "published" });
    expect(await nodeText(first, "guidance")).toBe("Guidance v2 upstream");
    expect(await nodeText(first, detachedNodeId)).toBe("Guidance v2 — local");
    expect(await templateInstance(first, "origin")).toMatchObject({
      state: "detached",
      sources: [
        {
          supertagId: "note-supertag",
          appliedSupertagId: "note-supertag",
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
    const program = setupProgram().flatMap((edit): readonly EditAction[] =>
      edit.kind === "node-create" && edit.nodeId === "guidance"
        ? [
            {
              kind: "node-create",
              occurrenceId: "guidance-original-occurrence",
              nodeId: "guidance",
              parentNodeId: "workspace",
              anchor: end,
            },
          ]
        : [edit],
    );
    expect((await mutate(opened, "reference-template", program)).status).toBe("published");

    const occurrences = (await section(opened, "origin", "occurrences")).occurrences;
    expect(occurrences["guidance-original-occurrence"]?.nodeId).toBe("guidance");
    expect(
      Object.values(occurrences).find(
        (occurrence) => occurrence.nodeId === "guidance" && occurrence.parentNodeId === "note-supertag",
      ),
    ).toMatchObject({
      nodeId: "guidance",
      parentNodeId: "note-supertag",
      derived: true,
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
              kind: "rich-text-splice",
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
            occurrenceId: "derived-supertag-original",
            nodeId: "derived-supertag",
            parentNodeId: "workspace",
            anchor: end,
            intrinsicNodeType: "supertag-definition",
          },
          {
            kind: "supertag-extension-add",
            supertagId: "derived-supertag",
            baseSupertagId: "note-supertag",
            anchor: end,
          },
          createSupertagApplication("note", "derived-supertag"),
        ])
      ).status,
    ).toBe("published");
    const instances = await templateInstances(opened, "origin");
    expect(instances).toHaveLength(1);
    const templateOccurrenceId = instances[0]?.sources[0]?.templateOccurrenceId;
    if (!templateOccurrenceId) {
      throw new Error("Expected inherited Template source Occurrence");
    }
    expect(instances[0]?.sources).toEqual([
      {
        supertagId: "note-supertag",
        appliedSupertagId: "note-supertag",
        templateOccurrenceId,
      },
      {
        supertagId: "note-supertag",
        appliedSupertagId: "derived-supertag",
        templateOccurrenceId,
      },
    ]);
    const occurrenceId = templateInstanceOccurrenceId("note", "guidance");
    const childOccurrences = await section(opened, "origin", "childOccurrences");
    expect(
      Object.values(childOccurrences.childOccurrences)
        .flat()
        .filter((candidate) => candidate === occurrenceId),
    ).toEqual([occurrenceId]);
  });
});

function setupProgram(): readonly EditAction[] {
  return [
    {
      kind: "node-create",
      occurrenceId: "note-supertag-original",
      nodeId: "note-supertag",
      parentNodeId: "workspace",
      anchor: end,
      intrinsicNodeType: "supertag-definition",
    },
    {
      kind: "node-create",
      nodeId: "guidance",
      occurrenceId: "guidance-original",
      parentNodeId: "workspace",
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
      kind: "rich-text-splice",
      nodeId: "guidance",
      deleteAtomIds: [],
      anchor: end,
      insert: "Guidance",
    },
    {
      kind: "template-member-add",
      supertagId: "note-supertag",
      templateNodeId: "guidance",
      anchor: end,
    },
    createSupertagApplication("note", "note-supertag"),
  ];
}

async function mutate(
  opened: Awaited<ReturnType<typeof open>>,
  invocationId: string,
  actions: readonly EditAction[],
  intent: "direct" | "proposal" = "direct",
) {
  return opened.workspace.execute({
    kind: "edit",
    workspaceId: "workspace",
    invocationId,
    actorId: "actor",
    intent,
    historyChannelId: "desktop",
    actions,
  });
}

async function open(documents: InMemoryDocumentStore, loroPeerId: `${number}`) {
  const facts = await FactAuthority.open({
    workspaceId: "workspace",
    loroPeerId,
    documents: documents,
  });
  return {
    facts,
    workspace: await Workspace.open({ workspaceId: "workspace", facts, versions }),
  };
}

async function templateInstance(opened: Awaited<ReturnType<typeof open>>, perspective: ProjectionPerspective) {
  const instances = await templateInstances(opened, perspective);
  const instance = instances[0];
  if (!instance) {
    throw new Error(`Expected a ${perspective} Template Node instance`);
  }
  return instance;
}

async function templateInstances(opened: Awaited<ReturnType<typeof open>>, perspective: ProjectionPerspective) {
  const page = await section(opened, perspective, "templateNodeInstances");
  return page.templateNodeInstances;
}

async function nodeText(
  opened: Awaited<ReturnType<typeof open>>,
  nodeId: string,
  perspective: ProjectionPerspective = "origin",
): Promise<string> {
  const page = await section(opened, perspective, "nodes");
  return (
    page.nodes[nodeId]?.content
      .filter((item) => item.kind === "text")
      .map((atom) => atom.value)
      .join("") ?? ""
  );
}

async function occurrenceNode(
  opened: Awaited<ReturnType<typeof open>>,
  occurrenceId: string,
): Promise<string | undefined> {
  const page = await section(opened, "origin", "occurrences");
  return page.occurrences[occurrenceId]?.nodeId;
}

async function occurrenceParent(
  opened: Awaited<ReturnType<typeof open>>,
  occurrenceId: string,
): Promise<string | undefined> {
  const page = await section(opened, "origin", "occurrences");
  return page.occurrences[occurrenceId]?.parentNodeId;
}

async function section<S extends ProjectionPage["section"]>(
  opened: Awaited<ReturnType<typeof open>>,
  perspective: ProjectionPerspective,
  requested: S,
): Promise<ProjectionPage & Readonly<{ section: S }>> {
  const result = await opened.workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective,
    section: requested,
  });
  if (!("section" in result) || result.section !== requested) {
    throw new Error(`Expected ${requested} Projection`);
  }
  return result as ProjectionPage & Readonly<{ section: S }>;
}
