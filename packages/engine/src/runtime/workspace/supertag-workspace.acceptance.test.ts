import { describe, expect, it } from "vitest";

import { admitAuthorityRecords } from "../../domain/admission/index.js";
import type { EditMutation } from "../../domain/edit/index.js";
import {
  FIELD_DEFINITION_NODE_TYPE,
  SUPERTAG_DEFINITION_NODE_TYPE,
  workspaceTrashNodeId,
  type NodeType,
} from "../../domain/fact/index.js";
import { InMemoryDocumentStore } from "../../persistence/in-memory-document-store.js";
import { createReplicaId, FactAuthorityStore } from "../authority/fact-authority-store.js";
import { ProposalWorkspace } from "./proposal-workspace.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("Supertag product model", () => {
  it("writes, queries, and restarts multiple Supertag applications with shared effective Fields", async () => {
    const documents = new InMemoryDocumentStore();
    const first = await open(documents, "101");
    const result = await first.workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "define-and-apply-supertags",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: supertagProgram(),
    });
    expect(result.status).toBe("published");
    await expectSupertagProjection(first.workspace, ["project-supertag", "work-supertag"]);

    await first.workspace.close();
    const restarted = await open(documents, "202");
    await expectSupertagProjection(restarted.workspace, ["project-supertag", "work-supertag"]);

    expect(
      (
        await restarted.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "remove-one-supertag-source",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: [{ kind: "supertag-remove", nodeId: "task", supertagId: "project-supertag" }],
        })
      ).status,
    ).toBe("published");
    await expectSupertagProjection(restarted.workspace, ["work-supertag"]);
  });

  it("shows deleted Definitions, blocks new use, permits cleanup, and restores the same identity", async () => {
    const documents = new InMemoryDocumentStore();
    const opened = await open(documents, "111");
    const setup = await opened.workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "definition-lifecycle-setup",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: [...supertagProgram(), ...nodeAtWorkspace("other")],
    });
    expect(setup.status).toBe("published");

    const deletion = await opened.workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "delete-project-definition",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: [{ kind: "node-delete", nodeId: "project-supertag" }],
    });
    if (deletion.status !== "published") {
      throw new Error("Expected Definition deletion to publish");
    }
    const deletionFactId = opened.facts
      .facts(deletion.receipt.factIds)
      .find(
        (fact) =>
          fact.body.kind === "contribution" &&
          fact.body.mutation.kind === "node-delete" &&
          fact.body.mutation.nodeId === "project-supertag",
      )?.id;
    if (!deletionFactId) {
      throw new Error("Expected Definition deletion Fact identity");
    }
    expect(await readNodePlacement(opened.workspace, "project-supertag")).toMatchObject({
      nodeId: "project-supertag",
      state: "trash",
    });
    expect(await readSupertagApplications(opened.workspace, "origin")).toMatchObject({
      task: ["project-supertag", "work-supertag"],
    });

    const blocked = await opened.workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "apply-deleted-definition",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: [{ kind: "supertag-apply", nodeId: "other", supertagId: "project-supertag", anchor: end }],
    });
    expect(blocked).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });

    const restoration = await opened.workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "remove-deleted-definition-application",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: [{ kind: "supertag-remove", nodeId: "task", supertagId: "project-supertag" }],
    });
    expect(restoration, JSON.stringify(restoration)).toMatchObject({ status: "published" });

    const restored = await opened.workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "restore-project-definition",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: [
        {
          kind: "node-restore",
          nodeId: "project-supertag",
          deletionFactId,
        },
        { kind: "supertag-apply", nodeId: "other", supertagId: "project-supertag", anchor: end },
      ],
    });
    expect(restored, JSON.stringify(restored)).toMatchObject({ status: "published" });
    expect(await readNodePlacement(opened.workspace, "project-supertag")).toMatchObject({
      state: "active",
    });
    expect(await readSupertagApplications(opened.workspace, "origin")).toMatchObject({
      other: ["project-supertag"],
    });
  });

  it("reviews moving a Definition to Trash before it changes Origin", async () => {
    const documents = new InMemoryDocumentStore();
    const opened = await open(documents, "112");
    expect(
      (
        await opened.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "proposal-trash-setup",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: supertagProgram(),
        })
      ).status,
    ).toBe("published");
    expect(
      (
        await opened.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "propose-supertag-trash",
          actorId: "actor",
          intent: "proposal",
          historyChannelId: "desktop",
          mutations: [{ kind: "node-delete", nodeId: "project-supertag" }],
        })
      ).status,
    ).toBe("published");

    expect(await readNodePlacement(opened.workspace, "project-supertag", "origin")).toMatchObject({
      state: "active",
    });
    expect(await readNodePlacement(opened.workspace, "project-supertag", "review")).toMatchObject({
      state: "trash",
    });
    expect(await readSupertagApplications(opened.workspace, "origin")).toMatchObject({
      task: ["project-supertag", "work-supertag"],
    });
    expect(await readSupertagApplications(opened.workspace, "review")).toMatchObject({
      task: ["project-supertag", "work-supertag"],
    });

    const review = await opened.workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in review) || !review.hunks[0]) {
      throw new Error("Expected Definition deletion Review Hunk");
    }
    expect(
      (
        await opened.workspace.execute({
          kind: "resolve-review",
          workspaceId: "workspace",
          invocationId: "accept-supertag-trash",
          actorId: "reviewer",
          decision: "accept",
          selection: review.hunks[0].selection,
        })
      ).status,
    ).toBe("published");
    expect(await readNodePlacement(opened.workspace, "project-supertag", "origin")).toMatchObject({
      state: "trash",
    });
  });

  it("makes a Definition deletion selection stale when a newly related instance appears", async () => {
    const opened = await open(new InMemoryDocumentStore(), "113");
    expect(
      (
        await opened.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "field-trash-setup",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: [...supertagProgram(), ...nodeAtWorkspace("task-2")],
        })
      ).status,
    ).toBe("published");
    expect(
      (
        await opened.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "propose-field-trash",
          actorId: "actor",
          intent: "proposal",
          historyChannelId: "desktop",
          mutations: [{ kind: "node-delete", nodeId: "status-field" }],
        })
      ).status,
    ).toBe("published");
    const review = await opened.workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in review) || !review.hunks[0]) {
      throw new Error("Expected Field Definition deletion Review Hunk");
    }
    const selection = review.hunks[0].selection;
    expect(
      selection.evidence.associatedImpactIds.some((impact) => impact.startsWith("effective-field/task/status-field/")),
    ).toBe(true);

    expect(
      (
        await opened.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "new-related-instance",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: [{ kind: "supertag-apply", nodeId: "task-2", supertagId: "project-supertag", anchor: end }],
        })
      ).status,
    ).toBe("published");
    expect(
      await opened.workspace.execute({
        kind: "resolve-review",
        workspaceId: "workspace",
        invocationId: "accept-stale-deletion",
        actorId: "reviewer",
        decision: "accept",
        selection,
      }),
    ).toMatchObject({ status: "rejected", error: { code: "stale-selection" } });
    const refreshed = await opened.workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in refreshed) || !refreshed.hunks[0]) {
      throw new Error("Expected refreshed Field Definition deletion Review Hunk");
    }
    expect(
      refreshed.hunks[0].selection.evidence.associatedImpactIds.some((impact) =>
        impact.startsWith("effective-field/task-2/status-field/"),
      ),
    ).toBe(true);
  });

  it("makes Supertag deletion and Extension selections stale when affected Fields materialize", async () => {
    const trash = await open(new InMemoryDocumentStore(), "114");
    expect(
      (
        await trash.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "supertag-trash-materialization-setup",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: [...supertagProgram(), nodeAt("late-field-node", "task", "late-field-occurrence")],
        })
      ).status,
    ).toBe("published");
    await trash.workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "propose-supertag-trash-for-materialization",
      actorId: "actor",
      intent: "proposal",
      historyChannelId: "desktop",
      mutations: [{ kind: "node-delete", nodeId: "project-supertag" }],
    });
    const trashReview = await trash.workspace.query({
      kind: "review",
      workspaceId: "workspace",
    });
    if (!("hunks" in trashReview) || !trashReview.hunks[0]) {
      throw new Error("Expected Supertag deletion Review Hunk");
    }
    const trashSelection = trashReview.hunks[0].selection;
    expect(
      trashSelection.evidence.associatedImpactIds.some((impact) =>
        impact.startsWith("effective-field/task/status-field/"),
      ),
    ).toBe(true);
    expect(
      (
        await trash.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "materialize-during-supertag-deletion",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: [
            {
              kind: "field-materialize",
              ownerNodeId: "task",
              fieldDefinitionId: "status-field",
              fieldNodeId: "late-field-node",
              fieldOccurrenceId: "late-field-occurrence",
            },
          ],
        })
      ).status,
    ).toBe("published");
    expect(
      await trash.workspace.execute({
        kind: "resolve-review",
        workspaceId: "workspace",
        invocationId: "reject-stale-supertag-deletion",
        actorId: "reviewer",
        decision: "accept",
        selection: trashSelection,
      }),
    ).toMatchObject({ status: "rejected", error: { code: "stale-selection" } });
    const refreshedTrash = await trash.workspace.query({
      kind: "review",
      workspaceId: "workspace",
    });
    if (!("hunks" in refreshedTrash) || !refreshedTrash.hunks[0]) {
      throw new Error("Expected refreshed Supertag deletion Review Hunk");
    }
    expect(refreshedTrash.hunks[0].selection.evidence.associatedImpactIds).toEqual(
      expect.arrayContaining(["materialized-field/task/status-field", "late-field-node", "late-field-occurrence"]),
    );

    const extension = await open(new InMemoryDocumentStore(), "115");
    expect(
      (
        await extension.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "extension-materialization-setup",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: [
            nodeAt("note", "workspace", "note-root"),
            ...definitionAtWorkspace("base-supertag", SUPERTAG_DEFINITION_NODE_TYPE),
            ...definitionAtWorkspace("child-supertag", SUPERTAG_DEFINITION_NODE_TYPE),
            ...definitionAtWorkspace("base-field", FIELD_DEFINITION_NODE_TYPE),
            nodeAt("extension-field-node", "note", "extension-field-occurrence"),
            {
              kind: "supertag-field-add",
              supertagId: "base-supertag",
              fieldDefinitionId: "base-field",
              fieldNodeId: "base-supertag-base-field-template-field",
              fieldOccurrenceId: "base-supertag-base-field-template-field-occurrence",
              anchor: end,
            },
            { kind: "supertag-apply", nodeId: "note", supertagId: "child-supertag", anchor: end },
          ],
        })
      ).status,
    ).toBe("published");
    await extension.workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "propose-extension-for-materialization",
      actorId: "actor",
      intent: "proposal",
      historyChannelId: "desktop",
      mutations: [
        {
          kind: "supertag-extension-add",
          supertagId: "child-supertag",
          baseSupertagId: "base-supertag",
          anchor: end,
        },
      ],
    });
    const extensionReview = await extension.workspace.query({
      kind: "review",
      workspaceId: "workspace",
    });
    if (!("hunks" in extensionReview) || !extensionReview.hunks[0]) {
      throw new Error("Expected Extension Review Hunk");
    }
    const extensionSelection = extensionReview.hunks[0].selection;
    expect(
      extensionSelection.evidence.associatedImpactIds.some((impact) =>
        impact.startsWith("effective-field/note/base-field/"),
      ),
    ).toBe(true);
    expect(
      extensionSelection.evidence.associatedImpactIds.some((impact) =>
        impact.startsWith("effective-field/child-supertag/"),
      ),
    ).toBe(false);
    expect(
      (
        await extension.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "materialize-during-extension-proposal",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: [
            {
              kind: "field-materialize",
              ownerNodeId: "note",
              fieldDefinitionId: "base-field",
              fieldNodeId: "extension-field-node",
              fieldOccurrenceId: "extension-field-occurrence",
            },
          ],
        })
      ).status,
    ).toBe("published");
    expect(
      await extension.workspace.execute({
        kind: "resolve-review",
        workspaceId: "workspace",
        invocationId: "reject-stale-extension",
        actorId: "reviewer",
        decision: "accept",
        selection: extensionSelection,
      }),
    ).toMatchObject({ status: "rejected", error: { code: "stale-selection" } });
    const refreshedExtension = await extension.workspace.query({
      kind: "review",
      workspaceId: "workspace",
    });
    if (!("hunks" in refreshedExtension) || !refreshedExtension.hunks[0]) {
      throw new Error("Expected refreshed Extension Review Hunk");
    }
    expect(refreshedExtension.hunks[0].selection.evidence.associatedImpactIds).toEqual(
      expect.arrayContaining([
        "materialized-field/note/base-field",
        "extension-field-node",
        "extension-field-occurrence",
      ]),
    );
  });

  it("projects stable Template Fields and keeps independent defaults as a conflict", async () => {
    const documents = new InMemoryDocumentStore();
    const first = await open(documents, "212");
    const configured = await first.workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "configure-shared-field",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: [
        ...supertagProgram(),
        {
          kind: "supertag-field-configure",
          supertagId: "project-supertag",
          fieldDefinitionId: "status-field",
          fieldNodeId: "project-supertag-status-field-template-field",

          config: {
            visibility: "pinned",
            staticDefault: [{ kind: "text", value: "Planned" }],
          },
        },
        {
          kind: "supertag-field-configure",
          supertagId: "work-supertag",
          fieldDefinitionId: "status-field",
          fieldNodeId: "work-supertag-status-field-template-field",

          config: {
            visibility: "optional",
            staticDefault: [{ kind: "text", value: "Started" }],
          },
        },
      ],
    });
    if (configured.status === "rejected") {
      throw new Error(`${configured.error.code}: ${configured.error.message}`);
    }
    expect(configured).toMatchObject({ status: "published" });

    const fieldItems = await first.workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "templateFields",
    });
    if (!("templateFields" in fieldItems)) {
      throw new Error("Expected Template Fields");
    }
    expect(fieldItems.templateFields["project-supertag"]?.[0]).toMatchObject({
      fieldNodeId: "project-supertag-status-field-template-field",
      fieldDefinitionId: "status-field",
      effectiveConfig: {
        visibility: "pinned",
        staticDefault: [{ kind: "text", value: "Planned" }],
      },
    });
    const effective = await first.workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "effectiveFields",
    });
    if (!("effectiveFields" in effective)) {
      throw new Error("Expected Effective Fields");
    }
    expect(effective.effectiveFields.task?.[0]).toMatchObject({
      fieldDefinitionId: "status-field",
      visibility: "pinned",
      effectiveConfig: null,
    });
    expect(effective.effectiveFields.task?.[0]?.configCandidates).toHaveLength(2);
    const conflicts = await first.workspace.query({ kind: "conflicts", workspaceId: "workspace" });
    expect(
      "issues" in conflicts &&
        conflicts.issues.some((issue) => issue.kind === "field-config-conflict" && issue.ownerNodeId === "task"),
    ).toBe(true);

    expect(
      (
        await first.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "remove-conflicting-source",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: [{ kind: "supertag-remove", nodeId: "task", supertagId: "work-supertag" }],
        })
      ).status,
    ).toBe("published");
    const resolvedConflicts = await first.workspace.query({
      kind: "conflicts",
      workspaceId: "workspace",
    });
    expect("issues" in resolvedConflicts && resolvedConflicts.issues).toEqual([]);

    await first.workspace.close();
    const restarted = await open(documents, "213");
    const afterRestart = await restarted.workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "effectiveFields",
    });
    expect("effectiveFields" in afterRestart && afterRestart.effectiveFields.task?.[0]?.effectiveConfig).toMatchObject({
      staticDefault: [{ kind: "text", value: "Planned" }],
    });
  });

  it("materializes a static default once and preserves its Node identity after source removal", async () => {
    const documents = new InMemoryDocumentStore();
    const first = await open(documents, "214");
    const setupCommand = {
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "default-setup",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: [
        nodeAt("task", "workspace", "task-occurrence"),
        ...definitionAtWorkspace("task-supertag", SUPERTAG_DEFINITION_NODE_TYPE),
        ...definitionAtWorkspace("status-field", FIELD_DEFINITION_NODE_TYPE),
        {
          kind: "supertag-field-add",
          supertagId: "task-supertag",
          fieldDefinitionId: "status-field",
          fieldNodeId: "task-supertag-status-field-template-field",
          fieldOccurrenceId: "task-supertag-status-field-template-field-occurrence",
          anchor: end,
        },
        {
          kind: "supertag-field-configure",
          supertagId: "task-supertag",
          fieldDefinitionId: "status-field",
          fieldNodeId: "task-supertag-status-field-template-field",

          config: {
            visibility: "pinned",
            staticDefault: [
              { kind: "text", value: "Planned" },
              { kind: "reference", nodeId: "task-supertag" },
            ],
          },
        },
        { kind: "supertag-apply", nodeId: "task", supertagId: "task-supertag", anchor: end },
      ],
    } as const;
    const setupResult = await first.workspace.execute(setupCommand);
    expect(setupResult.status).toBe("published");
    const fieldNodeId = "initialized-field:v1:task:status-field";
    const fieldOccurrenceId = "initialized-field-occ:v1:task:status-field";
    const valueOccurrenceIds = [`${fieldOccurrenceId}:value:0`, `${fieldOccurrenceId}:value:1`];
    const projection = await first.workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "materializedFields",
    });
    if (!("materializedFields" in projection)) {
      throw new Error("Expected initialized Materialized Field");
    }
    expect(projection.materializedFields.task).toEqual([
      {
        ownerNodeId: "task",
        fieldDefinitionId: "status-field",
        fieldNodeId,
        fieldOccurrenceId,
        valueOccurrenceIds,
      },
    ]);
    const values = await first.workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "occurrences",
    });
    if (!("occurrences" in values)) {
      throw new Error("Expected initialized Field values");
    }
    expect(values.occurrences[valueOccurrenceIds[1] ?? ""]?.nodeId).toBe("task-supertag");

    expect(await first.workspace.execute(setupCommand)).toEqual(setupResult);
    expect(
      (
        await first.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "remove-default-supertag",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: [{ kind: "supertag-remove", nodeId: "task", supertagId: "task-supertag" }],
        })
      ).status,
    ).toBe("published");
    const preserved = await first.workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "materializedFields",
    });
    expect("materializedFields" in preserved && preserved.materializedFields.task?.[0]?.fieldNodeId).toBe(fieldNodeId);

    await first.workspace.close();
    const restarted = await open(documents, "215");
    const afterRestart = await restarted.workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "materializedFields",
    });
    expect(
      "materializedFields" in afterRestart && afterRestart.materializedFields.task?.[0]?.valueOccurrenceIds,
    ).toEqual(valueOccurrenceIds);
  });

  it("accepts an initialized Field Proposal with the Supertag Application that supports it", async () => {
    const documents = new InMemoryDocumentStore();
    const { workspace } = await open(documents, "313");
    expect(
      (
        await workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "proposal-default-setup",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: [
            nodeAt("task", "workspace", "task-occurrence"),
            ...definitionAtWorkspace("task-supertag", SUPERTAG_DEFINITION_NODE_TYPE),
            ...definitionAtWorkspace("status-field", FIELD_DEFINITION_NODE_TYPE),
            {
              kind: "supertag-field-add",
              supertagId: "task-supertag",
              fieldDefinitionId: "status-field",
              fieldNodeId: "task-supertag-status-field-template-field",
              fieldOccurrenceId: "task-supertag-status-field-template-field-occurrence",
              anchor: end,
            },
            {
              kind: "supertag-field-configure",
              supertagId: "task-supertag",
              fieldDefinitionId: "status-field",
              fieldNodeId: "task-supertag-status-field-template-field",

              config: {
                visibility: "normal",
                staticDefault: [{ kind: "text", value: "Todo" }],
              },
            },
          ],
        })
      ).status,
    ).toBe("published");

    expect(
      (
        await workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "propose-application-with-default",
          actorId: "actor",
          intent: "proposal",
          historyChannelId: "desktop",
          mutations: [{ kind: "supertag-apply", nodeId: "task", supertagId: "task-supertag", anchor: end }],
        })
      ).status,
    ).toBe("published");

    const originBefore = await workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "materializedFields",
    });
    expect("materializedFields" in originBefore && originBefore.materializedFields.task).toBeUndefined();
    const review = await workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in review)) {
      throw new Error("Expected initialized Field Review Hunks");
    }
    const fieldHunk = review.hunks.find((hunk) => hunk.diffSpace.kind === "materialized-field");
    if (!fieldHunk) {
      throw new Error("Expected initialized Field Review Hunk");
    }
    expect(fieldHunk.selection.evidence.proposalTargets).toHaveLength(7);
    expect(fieldHunk.selection.evidence.supportClosure).toHaveLength(7);
    expect(fieldHunk.selection.evidence.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "field-materialization",
          ownerNodeId: "task",
          fieldDefinitionId: "status-field",
          originFieldNodeId: null,
          reviewFieldNodeId: "initialized-field:v1:task:status-field",
        }),
      ]),
    );
    expect(
      (
        await workspace.execute({
          kind: "resolve-review",
          workspaceId: "workspace",
          invocationId: "accept-application-with-default",
          actorId: "reviewer",
          decision: "accept",
          selection: fieldHunk.selection,
        })
      ).status,
    ).toBe("published");
    expect((await readSupertagApplications(workspace, "origin")).task).toEqual(["task-supertag"]);
    await expectNodeText(workspace, "initialized-field:v1:task:status-field:value:0", "Todo");
  });

  it("reviews and accepts a proposed Supertag Application with its effective Field impacts", async () => {
    const documents = new InMemoryDocumentStore();
    const { facts, workspace } = await open(documents, "303");
    const setup = await workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "supertag-proposal-setup",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: [
        ...nodeAtWorkspace("task"),
        ...definitionAtWorkspace("task-supertag", SUPERTAG_DEFINITION_NODE_TYPE),
        ...definitionAtWorkspace("status-field", FIELD_DEFINITION_NODE_TYPE),
        {
          kind: "supertag-field-add",
          supertagId: "task-supertag",
          fieldDefinitionId: "status-field",
          fieldNodeId: "task-supertag-status-field-template-field",
          fieldOccurrenceId: "task-supertag-status-field-template-field-occurrence",
          anchor: end,
        },
      ],
    });
    expect(setup.status).toBe("published");
    const result = await workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "propose-supertag-application",
      actorId: "actor",
      intent: "proposal",
      historyChannelId: "desktop",
      mutations: [{ kind: "supertag-apply", nodeId: "task", supertagId: "task-supertag", anchor: end }],
    });
    expect(result.status).toBe("published");
    const origin = await readSupertagApplications(workspace, "origin");
    const review = await readSupertagApplications(workspace, "review");
    expect(origin.task).toBeUndefined();
    expect(review.task).toEqual(["task-supertag"]);

    const query = await workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in query)) {
      throw new Error("Expected Supertag Review Hunk");
    }
    const hunk = query.hunks[0];
    if (!hunk) {
      throw new Error("Expected Supertag Review Hunk");
    }
    expect(query.hunks).toHaveLength(1);
    expect(hunk).toMatchObject({
      diffSpace: { kind: "supertag-application" },
      selection: {
        evidence: {
          effects: [
            {
              kind: "supertag-relation",
              relation: "application",
              ownerId: "task",
              targetId: "task-supertag",
              originIndex: null,
              reviewIndex: 0,
            },
          ],
        },
      },
    });
    expect(hunk.selection.evidence.associatedImpactIds.some((impact) => impact.includes("effective-field"))).toBe(true);
    const redone = await workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "unrelated-supertag-review-progress",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: nodeAtWorkspace("unrelated"),
    });
    expect(redone, JSON.stringify(redone)).toMatchObject({ status: "published" });

    const accepted = await workspace.execute({
      kind: "resolve-review",
      workspaceId: "workspace",
      invocationId: "accept-supertag-application",
      actorId: "reviewer",
      decision: "accept",
      selection: hunk.selection,
    });
    expect(accepted.status).toBe("published");
    await expectSupertagProjection(workspace, ["task-supertag"], "task", "status-field");
    expect(facts.snapshot().facts).toHaveLength(20);
  });

  it("stales a Supertag Application selection when its Effective Field consequences change", async () => {
    const documents = new InMemoryDocumentStore();
    const { facts, workspace } = await open(documents, "353");
    expect(
      (
        await workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "supertag-freshness-setup",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: [
            ...nodeAtWorkspace("task"),
            ...definitionAtWorkspace("task-supertag", SUPERTAG_DEFINITION_NODE_TYPE),
            ...definitionAtWorkspace("status-field", FIELD_DEFINITION_NODE_TYPE),
          ],
        })
      ).status,
    ).toBe("published");
    expect(
      (
        await workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "propose-supertag-before-field",
          actorId: "actor",
          intent: "proposal",
          historyChannelId: "desktop",
          mutations: [{ kind: "supertag-apply", nodeId: "task", supertagId: "task-supertag", anchor: end }],
        })
      ).status,
    ).toBe("published");
    const query = await workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in query) || !query.hunks[0]) {
      throw new Error("Expected Supertag Application Review Hunk");
    }
    const selection = query.hunks[0].selection;

    expect(
      (
        await workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "add-related-field",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: [
            {
              kind: "supertag-field-add",
              supertagId: "task-supertag",
              fieldDefinitionId: "status-field",
              fieldNodeId: "task-supertag-status-field-template-field",
              fieldOccurrenceId: "task-supertag-status-field-template-field-occurrence",
              anchor: end,
            },
          ],
        })
      ).status,
    ).toBe("published");
    const factCount = facts.snapshot().facts.length;
    const stale = await workspace.execute({
      kind: "resolve-review",
      workspaceId: "workspace",
      invocationId: "accept-stale-supertag-application",
      actorId: "reviewer",
      decision: "accept",
      selection,
    });
    expect(stale).toMatchObject({ status: "rejected", error: { code: "stale-selection" } });
    expect(facts.snapshot().facts).toHaveLength(factCount);
  });

  it("reviews and rejects a Supertag Field contribution without changing Origin", async () => {
    const documents = new InMemoryDocumentStore();
    const { workspace } = await open(documents, "404");
    expect(
      (
        await workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "field-proposal-setup",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: [
            ...nodeAtWorkspace("task"),
            ...definitionAtWorkspace("task-supertag", SUPERTAG_DEFINITION_NODE_TYPE),
            ...definitionAtWorkspace("status-field", FIELD_DEFINITION_NODE_TYPE),
            { kind: "supertag-apply", nodeId: "task", supertagId: "task-supertag", anchor: end },
          ],
        })
      ).status,
    ).toBe("published");
    expect(
      (
        await workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "propose-supertag-field",
          actorId: "actor",
          intent: "proposal",
          historyChannelId: "desktop",
          mutations: [
            {
              kind: "supertag-field-add",
              supertagId: "task-supertag",
              fieldDefinitionId: "status-field",
              fieldNodeId: "task-supertag-status-field-template-field",
              fieldOccurrenceId: "task-supertag-status-field-template-field-occurrence",
              anchor: end,
            },
          ],
        })
      ).status,
    ).toBe("published");
    const query = await workspace.query({ kind: "review", workspaceId: "workspace" });
    const supertagFieldHunk =
      "hunks" in query ? query.hunks.find((hunk) => hunk.diffSpace.kind === "supertag-template") : undefined;
    if (!supertagFieldHunk) {
      throw new Error("Expected Supertag Field Review Hunk");
    }
    expect(supertagFieldHunk.diffSpace.kind).toBe("supertag-template");
    const rejected = await workspace.execute({
      kind: "resolve-review",
      workspaceId: "workspace",
      invocationId: "reject-supertag-field",
      actorId: "reviewer",
      decision: "reject",
      selection: supertagFieldHunk.selection,
    });
    expect(rejected.status).toBe("published");
    const origin = await readSupertagFields(workspace, "origin");
    const review = await readSupertagFields(workspace, "review");
    expect(origin["task-supertag"]).toBeUndefined();
    expect(review["task-supertag"]).toBeUndefined();
  });

  it("reviews, accepts, queries, and restarts a Supertag Extension with inherited Fields", async () => {
    const documents = new InMemoryDocumentStore();
    const first = await open(documents, "454");
    const setup = await first.workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "extension-setup",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: [
        ...nodeAtWorkspace("note"),
        ...definitionAtWorkspace("base-supertag", SUPERTAG_DEFINITION_NODE_TYPE),
        ...definitionAtWorkspace("child-supertag", SUPERTAG_DEFINITION_NODE_TYPE),
        ...definitionAtWorkspace("base-field", FIELD_DEFINITION_NODE_TYPE),
        {
          kind: "supertag-field-add",
          supertagId: "base-supertag",
          fieldDefinitionId: "base-field",
          fieldNodeId: "base-supertag-base-field-template-field",
          fieldOccurrenceId: "base-supertag-base-field-template-field-occurrence",
          anchor: end,
        },
        { kind: "supertag-apply", nodeId: "note", supertagId: "child-supertag", anchor: end },
      ],
    });
    expect(setup, JSON.stringify(setup)).toMatchObject({ status: "published" });
    const proposed = await first.workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "propose-extension",
      actorId: "actor",
      intent: "proposal",
      historyChannelId: "desktop",
      mutations: [
        {
          kind: "supertag-extension-add",
          supertagId: "child-supertag",
          baseSupertagId: "base-supertag",
          anchor: end,
        },
      ],
    });
    expect(proposed, JSON.stringify(proposed)).toMatchObject({ status: "published" });
    const origin = await readProjectionMap(first.workspace, "origin", "supertagExtensions");
    const review = await readProjectionMap(first.workspace, "review", "supertagExtensions");
    expect(origin["child-supertag"]).toBeUndefined();
    expect(review["child-supertag"]).toEqual(["base-supertag"]);

    const query = await first.workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in query) || !query.hunks[0]) {
      throw new Error("Expected Supertag Extension Review Hunk");
    }
    expect(query.hunks[0]).toMatchObject({
      selection: {
        evidence: {
          effects: [
            {
              kind: "supertag-relation",
              relation: "extension",
              ownerId: "child-supertag",
              targetId: "base-supertag",
              originIndex: null,
              reviewIndex: 0,
            },
          ],
        },
      },
    });
    expect(
      (
        await first.workspace.execute({
          kind: "resolve-review",
          workspaceId: "workspace",
          invocationId: "accept-extension",
          actorId: "reviewer",
          decision: "accept",
          selection: query.hunks[0].selection,
        })
      ).status,
    ).toBe("published");
    const effective = await readProjectionMap(first.workspace, "origin", "effectiveFields");
    expect(effective.note).toMatchObject([{ fieldDefinitionId: "base-field", sourceSupertagIds: ["base-supertag"] }]);

    await first.workspace.close();
    const restarted = await open(documents, "455");
    const extensions = await readProjectionMap(restarted.workspace, "origin", "supertagExtensions");
    const search = await readProjectionMap(restarted.workspace, "origin", "supertagInstanceSupertags");
    expect(extensions["child-supertag"]).toEqual(["base-supertag"]);
    expect(search["base-supertag"]).toEqual(["base-supertag", "child-supertag"]);
  });

  it("materializes a Field as real structure and preserves authored values after Supertag removal", async () => {
    const documents = new InMemoryDocumentStore();
    const first = await open(documents, "505");
    const result = await first.workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "materialize-status-field",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: [
        nodeAt("task", "workspace", "task-occurrence"),
        nodeAt("status-on-task", "task", "status-on-task-occurrence"),
        nodeAt("todo", "status-on-task", "todo-value"),
        nodeAt("project", "status-on-task", "project-reference"),
        ...definitionAtWorkspace("task-supertag", SUPERTAG_DEFINITION_NODE_TYPE),
        ...definitionAtWorkspace("status-field", FIELD_DEFINITION_NODE_TYPE),
        {
          kind: "supertag-field-add",
          supertagId: "task-supertag",
          fieldDefinitionId: "status-field",
          fieldNodeId: "task-supertag-status-field-template-field",
          fieldOccurrenceId: "task-supertag-status-field-template-field-occurrence",
          anchor: end,
        },
        {
          kind: "supertag-field-configure",
          supertagId: "task-supertag",
          fieldDefinitionId: "status-field",
          fieldNodeId: "task-supertag-status-field-template-field",

          config: { visibility: "optional", staticDefault: null },
        },
        { kind: "supertag-apply", nodeId: "task", supertagId: "task-supertag", anchor: end },
        {
          kind: "field-materialize",
          ownerNodeId: "task",
          fieldDefinitionId: "status-field",
          fieldNodeId: "status-on-task",
          fieldOccurrenceId: "status-on-task-occurrence",
        },
      ],
    });
    expect(result.status).toBe("published");
    await expectMaterializedField(first.workspace, ["task-supertag"]);

    expect(
      (
        await first.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "remove-materialized-field-source",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: [{ kind: "supertag-remove", nodeId: "task", supertagId: "task-supertag" }],
        })
      ).status,
    ).toBe("published");
    await expectMaterializedField(first.workspace, []);

    await first.workspace.close();
    const restarted = await open(documents, "606");
    await expectMaterializedField(restarted.workspace, []);
  });

  it("keeps an Optional Field as a suggestion until explicit empty materialization and preserves nested values", async () => {
    const documents = new InMemoryDocumentStore();
    const first = await open(documents, "615");
    expect(
      (
        await first.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "optional-field-setup",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: [
            nodeAt("task", "workspace", "task-occurrence"),
            ...definitionAtWorkspace("task-supertag", SUPERTAG_DEFINITION_NODE_TYPE),
            ...definitionAtWorkspace("notes-field", FIELD_DEFINITION_NODE_TYPE),
            {
              kind: "supertag-field-add",
              supertagId: "task-supertag",
              fieldDefinitionId: "notes-field",
              fieldNodeId: "task-supertag-notes-field-template-field",
              fieldOccurrenceId: "task-supertag-notes-field-template-field-occurrence",
              anchor: end,
            },
            {
              kind: "supertag-field-configure",
              supertagId: "task-supertag",
              fieldDefinitionId: "notes-field",
              fieldNodeId: "task-supertag-notes-field-template-field",

              config: { visibility: "optional", staticDefault: null },
            },
            { kind: "supertag-apply", nodeId: "task", supertagId: "task-supertag", anchor: end },
          ],
        })
      ).status,
    ).toBe("published");
    expect((await readProjectionMap(first.workspace, "origin", "effectiveFields")).task).toEqual([]);
    expect(await projectionEntries(first.workspace, "materializedFields")).toEqual({});
    const items = await first.workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "templateFields",
    });
    expect("templateFields" in items ? items.templateFields["task-supertag"] : null).toMatchObject([
      { fieldDefinitionId: "notes-field", effectiveConfig: { visibility: "optional" } },
    ]);

    expect(
      (
        await first.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "select-empty-optional-field",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: [
            nodeAt("notes-on-task", "task", "notes-on-task-occurrence"),
            {
              kind: "field-materialize",
              ownerNodeId: "task",
              fieldDefinitionId: "notes-field",
              fieldNodeId: "notes-on-task",
              fieldOccurrenceId: "notes-on-task-occurrence",
            },
          ],
        })
      ).status,
    ).toBe("published");
    expect((await projectionEntries(first.workspace, "materializedFields")).task).toMatchObject([
      { fieldDefinitionId: "notes-field", valueOccurrenceIds: [] },
    ]);

    expect(
      (
        await first.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "nested-field-value",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: [
            nodeAt("value", "notes-on-task", "value-occurrence"),
            nodeAt("nested", "value", "nested-occurrence"),
            {
              kind: "text-splice",
              nodeId: "value",
              deleteAtomIds: [],
              anchor: end,
              insert: "value content",
            },
            {
              kind: "text-splice",
              nodeId: "nested",
              deleteAtomIds: [],
              anchor: end,
              insert: "nested content",
            },
          ],
        })
      ).status,
    ).toBe("published");
    expect((await projectionEntries(first.workspace, "childOccurrences")).value).toEqual(["nested-occurrence"]);

    expect(
      (
        await first.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "remove-optional-source",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: [{ kind: "supertag-remove", nodeId: "task", supertagId: "task-supertag" }],
        })
      ).status,
    ).toBe("published");
    await first.workspace.close();

    const restarted = await open(documents, "616");
    expect((await projectionEntries(restarted.workspace, "materializedFields")).task).toMatchObject([
      {
        fieldDefinitionId: "notes-field",
        fieldNodeId: "notes-on-task",
        valueOccurrenceIds: ["value-occurrence"],
      },
    ]);
    expect((await projectionEntries(restarted.workspace, "childOccurrences")).value).toEqual(["nested-occurrence"]);
    await expectNodeText(restarted.workspace, "value", "value content");
    await expectNodeText(restarted.workspace, "nested", "nested content");
  });

  it("undoes and redoes ordered Supertag Application and Field Contribution relations", async () => {
    const documents = new InMemoryDocumentStore();
    const { workspace } = await open(documents, "707");
    expect(
      (
        await workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "supertag-history-setup",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "setup",
          mutations: [
            ...nodeAtWorkspace("task"),
            ...definitionAtWorkspace("task-supertag", SUPERTAG_DEFINITION_NODE_TYPE),
            ...definitionAtWorkspace("status-field", FIELD_DEFINITION_NODE_TYPE),
          ],
        })
      ).status,
    ).toBe("published");
    const step = await workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "supertag-history-step",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "supertag-history",
      mutations: [
        { kind: "supertag-apply", nodeId: "task", supertagId: "task-supertag", anchor: end },
        {
          kind: "supertag-field-add",
          supertagId: "task-supertag",
          fieldDefinitionId: "status-field",
          fieldNodeId: "task-supertag-status-field-template-field",
          fieldOccurrenceId: "task-supertag-status-field-template-field-occurrence",
          anchor: end,
        },
      ],
    });
    expect(step.status).toBe("published");
    const history = await workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "supertag-history",
    });
    if (!("undo" in history) || !history.undo) {
      throw new Error("Expected Supertag History Undo");
    }
    expect(
      (
        await workspace.execute({
          kind: "undo",
          workspaceId: "workspace",
          invocationId: "undo-supertag-relations",
          actorId: "actor",
          selection: history.undo,
        })
      ).status,
    ).toBe("published");
    expect(await readSupertagApplications(workspace, "origin")).toEqual({});
    expect(await readSupertagFields(workspace, "origin")).toEqual({});

    const afterUndo = await workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "supertag-history",
    });
    if (!("redo" in afterUndo) || !afterUndo.redo) {
      throw new Error("Expected Supertag History Redo");
    }
    const redone = await workspace.execute({
      kind: "redo",
      workspaceId: "workspace",
      invocationId: "redo-supertag-relations",
      actorId: "actor",
      selection: afterUndo.redo,
    });
    expect(redone.status).toBe("published");
    expect((await readSupertagApplications(workspace, "origin")).task).toEqual(["task-supertag"]);
    expect((await readSupertagFields(workspace, "origin"))["task-supertag"]).toEqual(["status-field"]);
  });

  it("reviews and accepts a Materialized Field with stable Node and Occurrence identities", async () => {
    const documents = new InMemoryDocumentStore();
    const { workspace } = await open(documents, "808");
    const setup = await workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "materialization-proposal-setup",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: [
        nodeAt("task", "workspace", "task-occurrence"),
        ...definitionAtWorkspace("status-field", FIELD_DEFINITION_NODE_TYPE),
        nodeAt("status-on-task", "task", "status-on-task-occurrence"),
      ],
    });
    expect(setup.status).toBe("published");
    const proposed = await workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "propose-materialized-field",
      actorId: "actor",
      intent: "proposal",
      historyChannelId: "desktop",
      mutations: [
        {
          kind: "field-materialize",
          ownerNodeId: "task",
          fieldDefinitionId: "status-field",
          fieldNodeId: "status-on-task",
          fieldOccurrenceId: "status-on-task-occurrence",
        },
      ],
    });
    expect(proposed.status).toBe("published");
    const query = await workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in query) || !query.hunks[0]) {
      throw new Error("Expected Materialized Field Review Hunk");
    }
    expect(query.hunks[0]).toMatchObject({
      diffSpace: { kind: "materialized-field" },
      selection: {
        evidence: {
          effects: [
            {
              kind: "field-materialization",
              ownerNodeId: "task",
              fieldDefinitionId: "status-field",
              originFieldNodeId: null,
              reviewFieldNodeId: "status-on-task",
            },
            {
              kind: "node-type",
              identity: "status-on-task",
              origin: null,
              review: "field",
            },
          ],
        },
      },
    });
    const accepted = await workspace.execute({
      kind: "resolve-review",
      workspaceId: "workspace",
      invocationId: "accept-materialized-field",
      actorId: "reviewer",
      decision: "accept",
      selection: query.hunks[0].selection,
    });
    expect(accepted.status).toBe("published");
    const materialized = await workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "materializedFields",
    });
    expect("materializedFields" in materialized && materialized.materializedFields.task?.[0]?.fieldNodeId).toBe(
      "status-on-task",
    );
  });
});

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

async function expectNodeText(workspace: ProposalWorkspace, nodeId: string, expected: string): Promise<void> {
  const projection = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective: "origin",
    section: "nodes",
  });
  if (!("nodes" in projection)) {
    throw new Error("Expected Node Projection");
  }
  expect(
    projection.nodes[nodeId]?.content
      .filter((item) => item.kind === "text")
      .map((atom) => atom.value)
      .join(""),
  ).toBe(expected);
}

async function expectSupertagProjection(
  workspace: ProposalWorkspace,
  expectedApplications: readonly string[],
  nodeId = "task",
  fieldDefinitionId = "status-field",
): Promise<void> {
  const applications = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective: "origin",
    section: "supertagApplications",
  });
  const effective = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective: "origin",
    section: "effectiveFields",
  });
  expect("supertagApplications" in applications && applications.supertagApplications[nodeId]).toEqual(
    expectedApplications,
  );
  expect("effectiveFields" in effective && effective.effectiveFields[nodeId]?.[0]).toMatchObject({
    fieldDefinitionId,
    sourceSupertagIds: expectedApplications,
    materializedFieldNodeId: null,
  });
}

async function readSupertagApplications(
  workspace: ProposalWorkspace,
  perspective: "origin" | "review",
): Promise<Readonly<Record<string, readonly string[]>>> {
  const result = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective,
    section: "supertagApplications",
  });
  if (!("supertagApplications" in result)) {
    throw new Error("Expected Supertag Applications Projection");
  }
  return result.supertagApplications;
}

async function readSupertagFields(
  workspace: ProposalWorkspace,
  perspective: "origin" | "review",
): Promise<Readonly<Record<string, readonly string[]>>> {
  const result = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective,
    section: "supertagFields",
  });
  if (!("supertagFields" in result)) {
    throw new Error("Expected Supertag Fields Projection");
  }
  return result.supertagFields;
}

async function readNodePlacement(
  workspace: ProposalWorkspace,
  definitionId: string,
  perspective: "origin" | "review" = "origin",
) {
  const [nodes, owners] = await Promise.all([
    workspace.query({ kind: "projection", workspaceId: "workspace", perspective, section: "nodes" }),
    workspace.query({ kind: "projection", workspaceId: "workspace", perspective, section: "nodeOwners" }),
  ]);
  if (!("nodes" in nodes) || !("nodeOwners" in owners)) {
    throw new Error("Expected Node Graph Projection");
  }
  const node = nodes.nodes[definitionId];
  return node
    ? {
        nodeId: definitionId,
        nodeType: node.nodeType,
        state: owners.nodeOwners[definitionId] === workspaceTrashNodeId("workspace") ? "trash" : "active",
      }
    : undefined;
}

async function readProjectionMap(
  workspace: ProposalWorkspace,
  perspective: "origin" | "review",
  section: "supertagExtensions" | "supertagInstanceSupertags" | "supertagExtensionConflicts" | "effectiveFields",
): Promise<Readonly<Record<string, unknown>>> {
  const result = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective,
    section,
  });
  if (!("section" in result) || result.section !== section || !(section in result)) {
    throw new Error(`Expected ${section} Projection`);
  }
  switch (result.section) {
    case "supertagExtensions":
      return result.supertagExtensions;
    case "supertagInstanceSupertags":
      return result.supertagInstanceSupertags;
    case "supertagExtensionConflicts":
      return result.supertagExtensionConflicts;
    case "effectiveFields":
      return result.effectiveFields;
    default:
      throw new Error(`Expected ${section} Projection`);
  }
}

async function projectionEntries(
  workspace: ProposalWorkspace,
  section: "childOccurrences" | "materializedFields",
): Promise<Readonly<Record<string, unknown>>> {
  const result = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective: "origin",
    section,
    limit: 100,
  });
  if (!("section" in result) || result.section !== section || !(section in result)) {
    throw new Error(`Expected ${section} Projection`);
  }
  return result.section === "childOccurrences" ? result.childOccurrences : result.materializedFields;
}

async function expectMaterializedField(
  workspace: ProposalWorkspace,
  sourceSupertagIds: readonly string[],
): Promise<void> {
  const materialized = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective: "origin",
    section: "materializedFields",
  });
  const effective = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective: "origin",
    section: "effectiveFields",
  });
  if (!("materializedFields" in materialized) || !("effectiveFields" in effective)) {
    throw new Error("Expected Field Projection");
  }
  expect(materialized.materializedFields.task).toEqual([
    {
      ownerNodeId: "task",
      fieldDefinitionId: "status-field",
      fieldNodeId: "status-on-task",
      fieldOccurrenceId: "status-on-task-occurrence",
      valueOccurrenceIds: ["todo-value", "project-reference"],
    },
  ]);
  expect(
    effective.effectiveFields.task?.map(({ fieldDefinitionId, sourceSupertagIds, materializedFieldNodeId }) => ({
      fieldDefinitionId,
      sourceSupertagIds,
      materializedFieldNodeId,
    })),
  ).toEqual([
    {
      fieldDefinitionId: "status-field",
      sourceSupertagIds,
      materializedFieldNodeId: "status-on-task",
    },
  ]);
}

function supertagProgram(): readonly EditMutation[] {
  return [
    ...["task", "project-supertag", "work-supertag", "status-field"].flatMap(nodeAtWorkspace),
    {
      kind: "node-type-declare",
      nodeId: "project-supertag",
      nodeType: "supertag-definition",
    },
    { kind: "node-type-declare", nodeId: "work-supertag", nodeType: "supertag-definition" },
    { kind: "node-type-declare", nodeId: "status-field", nodeType: "field-definition" },
    {
      kind: "supertag-field-add",
      supertagId: "project-supertag",
      fieldDefinitionId: "status-field",
      fieldNodeId: "project-supertag-status-field-template-field",
      fieldOccurrenceId: "project-supertag-status-field-template-field-occurrence",
      anchor: end,
    },
    {
      kind: "supertag-field-add",
      supertagId: "work-supertag",
      fieldDefinitionId: "status-field",
      fieldNodeId: "work-supertag-status-field-template-field",
      fieldOccurrenceId: "work-supertag-status-field-template-field-occurrence",
      anchor: end,
    },
    { kind: "supertag-apply", nodeId: "task", supertagId: "project-supertag", anchor: end },
    { kind: "supertag-apply", nodeId: "task", supertagId: "work-supertag", anchor: end },
  ];
}

function nodeAtWorkspace(nodeId: string): readonly EditMutation[] {
  return [nodeAt(nodeId, "workspace", `${nodeId}-original`)];
}

function definitionAtWorkspace(nodeId: string, nodeType: NodeType): readonly EditMutation[] {
  return [
    {
      kind: "node-create",
      nodeId,
      occurrenceId: `${nodeId}-original`,
      parentNodeId: "workspace",
      anchor: end,
      nodeType: nodeType,
    },
  ];
}

function nodeAt(nodeId: string, parentNodeId: string, occurrenceId: string): EditMutation {
  return { kind: "node-create", nodeId, occurrenceId, parentNodeId, anchor: end };
}
