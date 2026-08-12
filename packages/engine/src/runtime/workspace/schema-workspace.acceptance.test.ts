import { describe, expect, it } from "vitest";

import type { Mutation } from "../../domain/fact/index.js";
import { InMemoryDocumentStore } from "../../persistence/in-memory-document-store.js";
import { createReplicaId, LoroFactStore } from "../authority/loro-fact-store.js";
import { ProposalWorkspace } from "./proposal-workspace.js";

const versions = { rulesVersion: "proposal-rules-1", schemaVersion: "lode-schema-12" } as const;
const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("Schema product model", () => {
  it("writes, queries, and restarts multiple Schema applications with shared effective Fields", async () => {
    const documents = new InMemoryDocumentStore();
    const first = await open(documents, "101");
    const result = await first.workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "define-and-apply-schemas",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: schemaProgram(),
    });
    expect(result.status).toBe("published");
    await expectSchemaProjection(first.workspace, ["project-schema", "work-schema"]);

    await first.workspace.close();
    const restarted = await open(documents, "202");
    await expectSchemaProjection(restarted.workspace, ["project-schema", "work-schema"]);

    expect(
      (
        await restarted.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "remove-one-schema-source",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: [{ kind: "schema-remove", nodeId: "task", schemaId: "project-schema" }],
        })
      ).status,
    ).toBe("published");
    await expectSchemaProjection(restarted.workspace, ["work-schema"]);
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
      mutations: [...schemaProgram(), { kind: "node-create", nodeId: "other" }],
    });
    expect(setup.status).toBe("published");

    const deletion = await opened.workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "delete-project-definition",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: [{ kind: "node-delete", nodeId: "project-schema" }],
    });
    if (deletion.status !== "published") {
      throw new Error("Expected Definition tombstone to publish");
    }
    const deletionFactId = deletion.receipt.factIds[0];
    if (!deletionFactId) {
      throw new Error("Expected Definition deletion Fact identity");
    }
    expect(await readDefinitionStatus(opened.workspace, "project-schema")).toMatchObject({
      definitionId: "project-schema",
      state: "deleted",
      deletionFactIds: [deletionFactId],
    });
    expect(await readSchemaApplications(opened.workspace, "origin")).toMatchObject({
      task: ["project-schema", "work-schema"],
    });

    const blocked = await opened.workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "apply-deleted-definition",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: [
        { kind: "schema-apply", nodeId: "other", schemaId: "project-schema", anchor: end },
      ],
    });
    expect(blocked).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });

    expect(
      (
        await opened.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "remove-deleted-definition-application",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: [{ kind: "schema-remove", nodeId: "task", schemaId: "project-schema" }],
        })
      ).status,
    ).toBe("published");

    expect(
      (
        await opened.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "restore-project-definition",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: [
            {
              kind: "node-restore",
              nodeId: "project-schema",
              deletionFactId,
            },
            { kind: "schema-apply", nodeId: "other", schemaId: "project-schema", anchor: end },
          ],
        })
      ).status,
    ).toBe("published");
    expect(await readDefinitionStatus(opened.workspace, "project-schema")).toMatchObject({
      state: "active",
      deletionFactIds: [],
    });
    expect(await readSchemaApplications(opened.workspace, "origin")).toMatchObject({
      other: ["project-schema"],
    });
  });

  it("reviews a Definition tombstone before it changes Origin", async () => {
    const documents = new InMemoryDocumentStore();
    const opened = await open(documents, "112");
    expect(
      (
        await opened.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "proposal-tombstone-setup",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: schemaProgram(),
        })
      ).status,
    ).toBe("published");
    expect(
      (
        await opened.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "propose-schema-tombstone",
          actorId: "actor",
          intent: "proposal",
          historyChannelId: "desktop",
          mutations: [{ kind: "node-delete", nodeId: "project-schema" }],
        })
      ).status,
    ).toBe("published");

    expect(await readDefinitionStatus(opened.workspace, "project-schema", "origin")).toMatchObject({
      state: "active",
    });
    expect(await readDefinitionStatus(opened.workspace, "project-schema", "review")).toMatchObject({
      state: "deleted",
    });
    expect(await readSchemaApplications(opened.workspace, "origin")).toMatchObject({
      task: ["project-schema", "work-schema"],
    });
    expect(await readSchemaApplications(opened.workspace, "review")).toMatchObject({
      task: ["project-schema", "work-schema"],
    });

    const review = await opened.workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in review) || !review.hunks[0]) {
      throw new Error("Expected Definition tombstone Review Hunk");
    }
    expect(
      (
        await opened.workspace.execute({
          kind: "resolve-review",
          workspaceId: "workspace",
          invocationId: "accept-schema-tombstone",
          actorId: "reviewer",
          decision: "accept",
          selection: review.hunks[0].selection,
        })
      ).status,
    ).toBe("published");
    expect(await readDefinitionStatus(opened.workspace, "project-schema", "origin")).toMatchObject({
      state: "deleted",
    });
  });

  it("makes a Definition tombstone selection stale when a newly related instance appears", async () => {
    const opened = await open(new InMemoryDocumentStore(), "113");
    expect(
      (
        await opened.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "field-tombstone-setup",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: [...schemaProgram(), { kind: "node-create", nodeId: "task-2" }],
        })
      ).status,
    ).toBe("published");
    expect(
      (
        await opened.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "propose-field-tombstone",
          actorId: "actor",
          intent: "proposal",
          historyChannelId: "desktop",
          mutations: [{ kind: "node-delete", nodeId: "status-field" }],
        })
      ).status,
    ).toBe("published");
    const review = await opened.workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in review) || !review.hunks[0]) {
      throw new Error("Expected Field Definition tombstone Review Hunk");
    }
    const selection = review.hunks[0].selection;
    expect(
      selection.evidence.associatedImpactIds.some((impact) =>
        impact.startsWith("seffective-field/stask/sstatus-field/"),
      ),
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
          mutations: [
            { kind: "schema-apply", nodeId: "task-2", schemaId: "project-schema", anchor: end },
          ],
        })
      ).status,
    ).toBe("published");
    expect(
      await opened.workspace.execute({
        kind: "resolve-review",
        workspaceId: "workspace",
        invocationId: "accept-stale-tombstone",
        actorId: "reviewer",
        decision: "accept",
        selection,
      }),
    ).toMatchObject({ status: "rejected", error: { code: "stale-selection" } });
    const refreshed = await opened.workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in refreshed) || !refreshed.hunks[0]) {
      throw new Error("Expected refreshed Field Definition tombstone Review Hunk");
    }
    expect(
      refreshed.hunks[0].selection.evidence.associatedImpactIds.some((impact) =>
        impact.startsWith("seffective-field/stask-2/sstatus-field/"),
      ),
    ).toBe(true);
  });

  it("makes Schema tombstone and Extension selections stale when affected Fields materialize", async () => {
    const tombstone = await open(new InMemoryDocumentStore(), "114");
    expect(
      (
        await tombstone.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "schema-tombstone-materialization-setup",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: [
            ...schemaProgram(),
            { kind: "node-create", nodeId: "late-field-node" },
            {
              kind: "occurrence-create",
              occurrenceId: "task-root",
              nodeId: "task",
              parentOccurrenceId: null,
              parentPolicy: "cascade",
              anchor: end,
            },
            {
              kind: "occurrence-create",
              occurrenceId: "late-field-occurrence",
              nodeId: "late-field-node",
              parentOccurrenceId: "task-root",
              parentPolicy: "cascade",
              anchor: end,
            },
          ],
        })
      ).status,
    ).toBe("published");
    await tombstone.workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "propose-schema-tombstone-for-materialization",
      actorId: "actor",
      intent: "proposal",
      historyChannelId: "desktop",
      mutations: [{ kind: "node-delete", nodeId: "project-schema" }],
    });
    const tombstoneReview = await tombstone.workspace.query({
      kind: "review",
      workspaceId: "workspace",
    });
    if (!("hunks" in tombstoneReview) || !tombstoneReview.hunks[0]) {
      throw new Error("Expected Schema tombstone Review Hunk");
    }
    const tombstoneSelection = tombstoneReview.hunks[0].selection;
    expect(
      tombstoneSelection.evidence.associatedImpactIds.some((impact) =>
        impact.startsWith("seffective-field/stask/sstatus-field/"),
      ),
    ).toBe(true);
    expect(
      (
        await tombstone.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "materialize-during-schema-tombstone",
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
      await tombstone.workspace.execute({
        kind: "resolve-review",
        workspaceId: "workspace",
        invocationId: "reject-stale-schema-tombstone",
        actorId: "reviewer",
        decision: "accept",
        selection: tombstoneSelection,
      }),
    ).toMatchObject({ status: "rejected", error: { code: "stale-selection" } });
    const refreshedTombstone = await tombstone.workspace.query({
      kind: "review",
      workspaceId: "workspace",
    });
    if (!("hunks" in refreshedTombstone) || !refreshedTombstone.hunks[0]) {
      throw new Error("Expected refreshed Schema tombstone Review Hunk");
    }
    expect(refreshedTombstone.hunks[0].selection.evidence.associatedImpactIds).toEqual(
      expect.arrayContaining([
        "smaterialized-field/stask/sstatus-field",
        "late-field-node",
        "late-field-occurrence",
      ]),
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
            { kind: "node-create", nodeId: "note" },
            { kind: "node-create", nodeId: "base-schema" },
            { kind: "node-create", nodeId: "child-schema" },
            { kind: "node-create", nodeId: "base-field" },
            { kind: "node-create", nodeId: "extension-field-node" },
            {
              kind: "occurrence-create",
              occurrenceId: "note-root",
              nodeId: "note",
              parentOccurrenceId: null,
              parentPolicy: "cascade",
              anchor: end,
            },
            {
              kind: "occurrence-create",
              occurrenceId: "extension-field-occurrence",
              nodeId: "extension-field-node",
              parentOccurrenceId: "note-root",
              parentPolicy: "cascade",
              anchor: end,
            },
            {
              kind: "schema-field-add",
              schemaId: "base-schema",
              fieldDefinitionId: "base-field",
              anchor: end,
            },
            { kind: "schema-apply", nodeId: "note", schemaId: "child-schema", anchor: end },
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
          kind: "schema-extension-add",
          schemaId: "child-schema",
          baseSchemaId: "base-schema",
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
        impact.startsWith("seffective-field/snote/sbase-field/"),
      ),
    ).toBe(true);
    expect(
      extensionSelection.evidence.associatedImpactIds.some((impact) =>
        impact.startsWith("seffective-field/schild-schema/"),
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
        "smaterialized-field/snote/sbase-field",
        "extension-field-node",
        "extension-field-occurrence",
      ]),
    );
  });

  it("projects stable Field Template Items and keeps independent defaults as a conflict", async () => {
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
        ...schemaProgram(),
        {
          kind: "schema-field-configure",
          schemaId: "project-schema",
          fieldDefinitionId: "status-field",
          config: {
            visibility: "pinned",
            staticDefault: [{ kind: "text", value: "Planned" }],
            initializer: null,
          },
        },
        {
          kind: "schema-field-configure",
          schemaId: "work-schema",
          fieldDefinitionId: "status-field",
          config: {
            visibility: "optional",
            staticDefault: [{ kind: "text", value: "Started" }],
            initializer: null,
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
      view: "origin",
      section: "schemaFieldItems",
    });
    if (!("schemaFieldItems" in fieldItems)) {
      throw new Error("Expected Schema Field Template Items");
    }
    expect(fieldItems.schemaFieldItems["project-schema"]?.[0]).toMatchObject({
      templateItemId: "field-template:v1:project-schema:status-field",
      fieldDefinitionId: "status-field",
      effectiveConfig: {
        visibility: "pinned",
        staticDefault: [{ kind: "text", value: "Planned" }],
      },
    });
    const effective = await first.workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      view: "origin",
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
        conflicts.issues.some(
          (issue) => issue.kind === "field-config-conflict" && issue.ownerNodeId === "task",
        ),
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
          mutations: [{ kind: "schema-remove", nodeId: "task", schemaId: "work-schema" }],
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
      view: "origin",
      section: "effectiveFields",
    });
    expect(
      "effectiveFields" in afterRestart && afterRestart.effectiveFields.task?.[0]?.effectiveConfig,
    ).toMatchObject({ staticDefault: [{ kind: "text", value: "Planned" }] });
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
        { kind: "node-create", nodeId: "task" },
        {
          kind: "occurrence-create",
          occurrenceId: "task-occurrence",
          nodeId: "task",
          parentOccurrenceId: null,
          parentPolicy: "cascade",
          anchor: end,
        },
        { kind: "canonical-occurrence-set", nodeId: "task", occurrenceId: "task-occurrence" },
        { kind: "node-create", nodeId: "task-schema" },
        { kind: "node-create", nodeId: "status-field" },
        {
          kind: "schema-field-add",
          schemaId: "task-schema",
          fieldDefinitionId: "status-field",
          anchor: end,
        },
        {
          kind: "schema-field-configure",
          schemaId: "task-schema",
          fieldDefinitionId: "status-field",
          config: {
            visibility: "pinned",
            staticDefault: [
              { kind: "text", value: "Planned" },
              { kind: "reference", nodeId: "task-schema" },
            ],
            initializer: null,
          },
        },
        { kind: "schema-apply", nodeId: "task", schemaId: "task-schema", anchor: end },
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
      view: "origin",
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
      view: "origin",
      section: "occurrences",
    });
    if (!("occurrences" in values)) {
      throw new Error("Expected initialized Field values");
    }
    expect(values.occurrences[valueOccurrenceIds[1] ?? ""]?.nodeId).toBe("task-schema");

    expect(await first.workspace.execute(setupCommand)).toEqual(setupResult);
    expect(
      (
        await first.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "remove-default-schema",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: [{ kind: "schema-remove", nodeId: "task", schemaId: "task-schema" }],
        })
      ).status,
    ).toBe("published");
    const preserved = await first.workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      view: "origin",
      section: "materializedFields",
    });
    expect(
      "materializedFields" in preserved && preserved.materializedFields.task?.[0]?.fieldNodeId,
    ).toBe(fieldNodeId);

    await first.workspace.close();
    const restarted = await open(documents, "215");
    const afterRestart = await restarted.workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      view: "origin",
      section: "materializedFields",
    });
    expect(
      "materializedFields" in afterRestart &&
        afterRestart.materializedFields.task?.[0]?.valueOccurrenceIds,
    ).toEqual(valueOccurrenceIds);
  });

  it("evaluates an initializer at Schema application once and never recomputes it", async () => {
    const documents = new InMemoryDocumentStore();
    const first = await open(documents, "216");
    expect(
      (
        await first.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "initializer-setup",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: [
            { kind: "node-create", nodeId: "note" },
            {
              kind: "occurrence-create",
              occurrenceId: "note-occurrence",
              nodeId: "note",
              parentOccurrenceId: null,
              parentPolicy: "cascade",
              anchor: end,
            },
            { kind: "canonical-occurrence-set", nodeId: "note", occurrenceId: "note-occurrence" },
            {
              kind: "text-splice",
              nodeId: "note",
              deleteAtomIds: [],
              anchor: end,
              insert: "Before",
            },
            { kind: "node-create", nodeId: "note-schema" },
            { kind: "node-create", nodeId: "snapshot-field" },
            {
              kind: "schema-field-add",
              schemaId: "note-schema",
              fieldDefinitionId: "snapshot-field",
              anchor: end,
            },
            {
              kind: "schema-field-configure",
              schemaId: "note-schema",
              fieldDefinitionId: "snapshot-field",
              config: {
                visibility: "normal",
                staticDefault: null,
                initializer: { kind: "application-node-text" },
              },
            },
            { kind: "schema-apply", nodeId: "note", schemaId: "note-schema", anchor: end },
          ],
        })
      ).status,
    ).toBe("published");
    const initializedValueNodeId = "initialized-field:v1:note:snapshot-field:value:0";
    await expectNodeText(first.workspace, initializedValueNodeId, "Before");

    expect(
      (
        await first.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "edit-after-initializer",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: [
            {
              kind: "text-splice",
              nodeId: "note",
              deleteAtomIds: [],
              anchor: end,
              insert: " After",
            },
          ],
        })
      ).status,
    ).toBe("published");
    await expectNodeText(first.workspace, initializedValueNodeId, "Before");

    await first.workspace.close();
    const restarted = await open(documents, "217");
    await expectNodeText(restarted.workspace, initializedValueNodeId, "Before");
  });

  it("accepts an initialized Field Proposal with the Schema Application that supports it", async () => {
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
            { kind: "node-create", nodeId: "task" },
            { kind: "node-create", nodeId: "task-schema" },
            { kind: "node-create", nodeId: "status-field" },
            {
              kind: "occurrence-create",
              occurrenceId: "task-occurrence",
              nodeId: "task",
              parentOccurrenceId: null,
              parentPolicy: "cascade",
              anchor: end,
            },
            {
              kind: "schema-field-add",
              schemaId: "task-schema",
              fieldDefinitionId: "status-field",
              anchor: end,
            },
            {
              kind: "schema-field-configure",
              schemaId: "task-schema",
              fieldDefinitionId: "status-field",
              config: {
                visibility: "normal",
                staticDefault: [{ kind: "text", value: "Todo" }],
                initializer: null,
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
          mutations: [
            { kind: "schema-apply", nodeId: "task", schemaId: "task-schema", anchor: end },
          ],
        })
      ).status,
    ).toBe("published");

    const originBefore = await workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      view: "origin",
      section: "materializedFields",
    });
    expect(
      "materializedFields" in originBefore && originBefore.materializedFields.task,
    ).toBeUndefined();
    const review = await workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in review)) {
      throw new Error("Expected initialized Field Review Hunks");
    }
    const fieldHunk = review.hunks.find((hunk) => hunk.diffSpace.kind === "materialized-field");
    if (!fieldHunk) {
      throw new Error("Expected initialized Field Review Hunk");
    }
    expect(fieldHunk.selection.evidence.proposalTargets).toHaveLength(1);
    expect(fieldHunk.selection.evidence.supportClosure).toHaveLength(2);
    expect(fieldHunk.selection.evidence.effects).toMatchObject([
      {
        kind: "field-materialization",
        ownerNodeId: "task",
        fieldDefinitionId: "status-field",
        originFieldNodeId: null,
        reviewFieldNodeId: "initialized-field:v1:task:status-field",
      },
    ]);
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
    expect((await readSchemaApplications(workspace, "origin")).task).toEqual(["task-schema"]);
    await expectNodeText(workspace, "initialized-field:v1:task:status-field:value:0", "Todo");
  });

  it("reviews and accepts a proposed Schema Application with its effective Field impacts", async () => {
    const documents = new InMemoryDocumentStore();
    const { facts, workspace } = await open(documents, "303");
    const setup = await workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "schema-proposal-setup",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: [
        { kind: "node-create", nodeId: "task" },
        { kind: "node-create", nodeId: "task-schema" },
        { kind: "node-create", nodeId: "status-field" },
        {
          kind: "schema-field-add",
          schemaId: "task-schema",
          fieldDefinitionId: "status-field",
          anchor: end,
        },
      ],
    });
    expect(setup.status).toBe("published");
    const result = await workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "propose-schema-application",
      actorId: "actor",
      intent: "proposal",
      historyChannelId: "desktop",
      mutations: [{ kind: "schema-apply", nodeId: "task", schemaId: "task-schema", anchor: end }],
    });
    expect(result.status).toBe("published");
    const origin = await readSchemaApplications(workspace, "origin");
    const review = await readSchemaApplications(workspace, "review");
    expect(origin.task).toBeUndefined();
    expect(review.task).toEqual(["task-schema"]);

    const query = await workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in query)) {
      throw new Error("Expected Schema Review Hunk");
    }
    const hunk = query.hunks[0];
    if (!hunk) {
      throw new Error("Expected Schema Review Hunk");
    }
    expect(query.hunks).toHaveLength(1);
    expect(hunk).toMatchObject({
      diffSpace: { kind: "schema-application" },
      selection: {
        evidence: {
          effects: [
            {
              kind: "schema-relation",
              relation: "application",
              ownerId: "task",
              targetId: "task-schema",
              originIndex: null,
              reviewIndex: 0,
            },
          ],
        },
      },
    });
    expect(
      hunk.selection.evidence.associatedImpactIds.some((impact) =>
        impact.includes("effective-field"),
      ),
    ).toBe(true);
    const redone = await workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "unrelated-schema-review-progress",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "desktop",
      mutations: [{ kind: "node-create", nodeId: "unrelated" }],
    });
    expect(redone, JSON.stringify(redone)).toMatchObject({ status: "published" });

    const accepted = await workspace.execute({
      kind: "resolve-review",
      workspaceId: "workspace",
      invocationId: "accept-schema-application",
      actorId: "reviewer",
      decision: "accept",
      selection: hunk.selection,
    });
    expect(accepted.status).toBe("published");
    await expectSchemaProjection(workspace, ["task-schema"], "task", "status-field");
    expect(facts.snapshot().facts).toHaveLength(7);
  });

  it("stales a Schema Application selection when its Effective Field consequences change", async () => {
    const documents = new InMemoryDocumentStore();
    const { facts, workspace } = await open(documents, "353");
    expect(
      (
        await workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "schema-freshness-setup",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: [
            { kind: "node-create", nodeId: "task" },
            { kind: "node-create", nodeId: "task-schema" },
            { kind: "node-create", nodeId: "status-field" },
          ],
        })
      ).status,
    ).toBe("published");
    expect(
      (
        await workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "propose-schema-before-field",
          actorId: "actor",
          intent: "proposal",
          historyChannelId: "desktop",
          mutations: [
            { kind: "schema-apply", nodeId: "task", schemaId: "task-schema", anchor: end },
          ],
        })
      ).status,
    ).toBe("published");
    const query = await workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in query) || !query.hunks[0]) {
      throw new Error("Expected Schema Application Review Hunk");
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
              kind: "schema-field-add",
              schemaId: "task-schema",
              fieldDefinitionId: "status-field",
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
      invocationId: "accept-stale-schema-application",
      actorId: "reviewer",
      decision: "accept",
      selection,
    });
    expect(stale).toMatchObject({ status: "rejected", error: { code: "stale-selection" } });
    expect(facts.snapshot().facts).toHaveLength(factCount);
  });

  it("reviews and rejects a Schema Field contribution without changing Origin", async () => {
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
            { kind: "node-create", nodeId: "task" },
            { kind: "node-create", nodeId: "task-schema" },
            { kind: "node-create", nodeId: "status-field" },
            { kind: "schema-apply", nodeId: "task", schemaId: "task-schema", anchor: end },
          ],
        })
      ).status,
    ).toBe("published");
    expect(
      (
        await workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "propose-schema-field",
          actorId: "actor",
          intent: "proposal",
          historyChannelId: "desktop",
          mutations: [
            {
              kind: "schema-field-add",
              schemaId: "task-schema",
              fieldDefinitionId: "status-field",
              anchor: end,
            },
          ],
        })
      ).status,
    ).toBe("published");
    const query = await workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in query) || !query.hunks[0]) {
      throw new Error("Expected Schema Field Review Hunk");
    }
    expect(query.hunks[0].diffSpace.kind).toBe("schema-template");
    const rejected = await workspace.execute({
      kind: "resolve-review",
      workspaceId: "workspace",
      invocationId: "reject-schema-field",
      actorId: "reviewer",
      decision: "reject",
      selection: query.hunks[0].selection,
    });
    expect(rejected.status).toBe("published");
    const origin = await readSchemaFields(workspace, "origin");
    const review = await readSchemaFields(workspace, "review");
    expect(origin["task-schema"]).toBeUndefined();
    expect(review["task-schema"]).toBeUndefined();
  });

  it("reviews, accepts, queries, and restarts a Schema Extension with inherited Fields", async () => {
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
        { kind: "node-create", nodeId: "note" },
        { kind: "node-create", nodeId: "base-schema" },
        { kind: "node-create", nodeId: "child-schema" },
        { kind: "node-create", nodeId: "base-field" },
        {
          kind: "schema-field-add",
          schemaId: "base-schema",
          fieldDefinitionId: "base-field",
          anchor: end,
        },
        { kind: "schema-apply", nodeId: "note", schemaId: "child-schema", anchor: end },
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
          kind: "schema-extension-add",
          schemaId: "child-schema",
          baseSchemaId: "base-schema",
          anchor: end,
        },
      ],
    });
    expect(proposed, JSON.stringify(proposed)).toMatchObject({ status: "published" });
    const origin = await readProjectionMap(first.workspace, "origin", "schemaExtensions");
    const review = await readProjectionMap(first.workspace, "review", "schemaExtensions");
    expect(origin["child-schema"]).toBeUndefined();
    expect(review["child-schema"]).toEqual(["base-schema"]);

    const query = await first.workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in query) || !query.hunks[0]) {
      throw new Error("Expected Schema Extension Review Hunk");
    }
    expect(query.hunks[0]).toMatchObject({
      selection: {
        evidence: {
          effects: [
            {
              kind: "schema-relation",
              relation: "extension",
              ownerId: "child-schema",
              targetId: "base-schema",
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
    expect(effective.note).toMatchObject([
      { fieldDefinitionId: "base-field", sourceSchemaIds: ["base-schema"] },
    ]);

    await first.workspace.close();
    const restarted = await open(documents, "455");
    const extensions = await readProjectionMap(restarted.workspace, "origin", "schemaExtensions");
    const search = await readProjectionMap(restarted.workspace, "origin", "schemaSearchMembers");
    expect(extensions["child-schema"]).toEqual(["base-schema"]);
    expect(search["base-schema"]).toEqual(["base-schema", "child-schema"]);
  });

  it("materializes a Field as real structure and preserves authored values after Schema removal", async () => {
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
        ...["task", "task-schema", "status-field", "status-on-task", "todo", "project"].map(
          (nodeId): Mutation => ({ kind: "node-create", nodeId }),
        ),
        {
          kind: "occurrence-create",
          occurrenceId: "task-occurrence",
          nodeId: "task",
          parentOccurrenceId: null,
          parentPolicy: "cascade",
          anchor: end,
        },
        {
          kind: "occurrence-create",
          occurrenceId: "status-on-task-occurrence",
          nodeId: "status-on-task",
          parentOccurrenceId: "task-occurrence",
          parentPolicy: "cascade",
          anchor: end,
        },
        {
          kind: "schema-field-add",
          schemaId: "task-schema",
          fieldDefinitionId: "status-field",
          anchor: end,
        },
        {
          kind: "schema-field-configure",
          schemaId: "task-schema",
          fieldDefinitionId: "status-field",
          config: { visibility: "optional", staticDefault: null, initializer: null },
        },
        { kind: "schema-apply", nodeId: "task", schemaId: "task-schema", anchor: end },
        {
          kind: "field-materialize",
          ownerNodeId: "task",
          fieldDefinitionId: "status-field",
          fieldNodeId: "status-on-task",
          fieldOccurrenceId: "status-on-task-occurrence",
        },
        {
          kind: "occurrence-create",
          occurrenceId: "todo-value",
          nodeId: "todo",
          parentOccurrenceId: "status-on-task-occurrence",
          parentPolicy: "cascade",
          anchor: end,
        },
        {
          kind: "occurrence-create",
          occurrenceId: "project-reference",
          nodeId: "project",
          parentOccurrenceId: "status-on-task-occurrence",
          parentPolicy: "cascade",
          anchor: end,
        },
      ],
    });
    expect(result.status).toBe("published");
    await expectMaterializedField(first.workspace, ["task-schema"]);

    expect(
      (
        await first.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "remove-materialized-field-source",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: [{ kind: "schema-remove", nodeId: "task", schemaId: "task-schema" }],
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
            ...["task", "task-schema", "notes-field"].map((nodeId): Mutation => ({
              kind: "node-create",
              nodeId,
            })),
            {
              kind: "occurrence-create",
              occurrenceId: "task-occurrence",
              nodeId: "task",
              parentOccurrenceId: null,
              parentPolicy: "cascade",
              anchor: end,
            },
            {
              kind: "schema-field-add",
              schemaId: "task-schema",
              fieldDefinitionId: "notes-field",
              anchor: end,
            },
            {
              kind: "schema-field-configure",
              schemaId: "task-schema",
              fieldDefinitionId: "notes-field",
              config: { visibility: "optional", staticDefault: null, initializer: null },
            },
            { kind: "schema-apply", nodeId: "task", schemaId: "task-schema", anchor: end },
          ],
        })
      ).status,
    ).toBe("published");
    expect((await readProjectionMap(first.workspace, "origin", "effectiveFields")).task).toEqual(
      [],
    );
    expect(await projectionEntries(first.workspace, "materializedFields")).toEqual({});
    const items = await first.workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      view: "origin",
      section: "schemaFieldItems",
    });
    expect(
      "schemaFieldItems" in items ? items.schemaFieldItems["task-schema"] : null,
    ).toMatchObject([
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
            { kind: "node-create", nodeId: "notes-on-task" },
            {
              kind: "occurrence-create",
              occurrenceId: "notes-on-task-occurrence",
              nodeId: "notes-on-task",
              parentOccurrenceId: "task-occurrence",
              parentPolicy: "cascade",
              anchor: end,
            },
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
            { kind: "node-create", nodeId: "value" },
            { kind: "node-create", nodeId: "nested" },
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
            {
              kind: "occurrence-create",
              occurrenceId: "value-occurrence",
              nodeId: "value",
              parentOccurrenceId: "notes-on-task-occurrence",
              parentPolicy: "cascade",
              anchor: end,
            },
            {
              kind: "occurrence-create",
              occurrenceId: "nested-occurrence",
              nodeId: "nested",
              parentOccurrenceId: "value-occurrence",
              parentPolicy: "cascade",
              anchor: end,
            },
          ],
        })
      ).status,
    ).toBe("published");
    expect((await projectionEntries(first.workspace, "children"))["value-occurrence"]).toEqual([
      "nested-occurrence",
    ]);

    expect(
      (
        await first.workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "remove-optional-source",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "desktop",
          mutations: [{ kind: "schema-remove", nodeId: "task", schemaId: "task-schema" }],
        })
      ).status,
    ).toBe("published");
    await first.workspace.close();

    const restarted = await open(documents, "616");
    expect((await projectionEntries(restarted.workspace, "materializedFields")).task).toMatchObject(
      [
        {
          fieldDefinitionId: "notes-field",
          fieldNodeId: "notes-on-task",
          valueOccurrenceIds: ["value-occurrence"],
        },
      ],
    );
    expect((await projectionEntries(restarted.workspace, "children"))["value-occurrence"]).toEqual([
      "nested-occurrence",
    ]);
    await expectNodeText(restarted.workspace, "value", "value content");
    await expectNodeText(restarted.workspace, "nested", "nested content");
  });

  it("undoes and redoes ordered Schema Application and Field Contribution relations", async () => {
    const documents = new InMemoryDocumentStore();
    const { workspace } = await open(documents, "707");
    expect(
      (
        await workspace.execute({
          kind: "mutate",
          workspaceId: "workspace",
          invocationId: "schema-history-setup",
          actorId: "actor",
          intent: "direct",
          historyChannelId: "setup",
          mutations: [
            { kind: "node-create", nodeId: "task" },
            { kind: "node-create", nodeId: "task-schema" },
            { kind: "node-create", nodeId: "status-field" },
          ],
        })
      ).status,
    ).toBe("published");
    const step = await workspace.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "schema-history-step",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "schema-history",
      mutations: [
        { kind: "schema-apply", nodeId: "task", schemaId: "task-schema", anchor: end },
        {
          kind: "schema-field-add",
          schemaId: "task-schema",
          fieldDefinitionId: "status-field",
          anchor: end,
        },
      ],
    });
    expect(step.status).toBe("published");
    const history = await workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "schema-history",
    });
    if (!("undo" in history) || !history.undo) {
      throw new Error("Expected Schema History Undo");
    }
    expect(
      (
        await workspace.execute({
          kind: "undo",
          workspaceId: "workspace",
          invocationId: "undo-schema-relations",
          actorId: "actor",
          selection: history.undo,
        })
      ).status,
    ).toBe("published");
    expect(await readSchemaApplications(workspace, "origin")).toEqual({});
    expect(await readSchemaFields(workspace, "origin")).toEqual({});

    const afterUndo = await workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "schema-history",
    });
    if (!("redo" in afterUndo) || !afterUndo.redo) {
      throw new Error("Expected Schema History Redo");
    }
    const redone = await workspace.execute({
      kind: "redo",
      workspaceId: "workspace",
      invocationId: "redo-schema-relations",
      actorId: "actor",
      selection: afterUndo.redo,
    });
    expect(redone.status).toBe("published");
    expect((await readSchemaApplications(workspace, "origin")).task).toEqual(["task-schema"]);
    expect((await readSchemaFields(workspace, "origin"))["task-schema"]).toEqual(["status-field"]);
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
        { kind: "node-create", nodeId: "task" },
        { kind: "node-create", nodeId: "status-field" },
        { kind: "node-create", nodeId: "status-on-task" },
        {
          kind: "occurrence-create",
          occurrenceId: "task-occurrence",
          nodeId: "task",
          parentOccurrenceId: null,
          parentPolicy: "cascade",
          anchor: end,
        },
        {
          kind: "occurrence-create",
          occurrenceId: "status-on-task-occurrence",
          nodeId: "status-on-task",
          parentOccurrenceId: "task-occurrence",
          parentPolicy: "cascade",
          anchor: end,
        },
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
      view: "origin",
      section: "materializedFields",
    });
    expect(
      "materializedFields" in materialized &&
        materialized.materializedFields.task?.[0]?.fieldNodeId,
    ).toBe("status-on-task");
  });
});

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

async function expectNodeText(
  workspace: ProposalWorkspace,
  nodeId: string,
  expected: string,
): Promise<void> {
  const projection = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    view: "origin",
    section: "nodes",
  });
  if (!("nodes" in projection)) {
    throw new Error("Expected Node Projection");
  }
  expect(projection.nodes[nodeId]?.text.map((atom) => atom.value).join("")).toBe(expected);
}

async function expectSchemaProjection(
  workspace: ProposalWorkspace,
  expectedApplications: readonly string[],
  nodeId = "task",
  fieldDefinitionId = "status-field",
): Promise<void> {
  const applications = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    view: "origin",
    section: "schemaApplications",
  });
  const effective = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    view: "origin",
    section: "effectiveFields",
  });
  expect("schemaApplications" in applications && applications.schemaApplications[nodeId]).toEqual(
    expectedApplications,
  );
  expect("effectiveFields" in effective && effective.effectiveFields[nodeId]?.[0]).toMatchObject({
    fieldDefinitionId,
    sourceSchemaIds: expectedApplications,
    materializedFieldNodeId: null,
  });
}

async function readSchemaApplications(
  workspace: ProposalWorkspace,
  view: "origin" | "review",
): Promise<Readonly<Record<string, readonly string[]>>> {
  const result = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    view,
    section: "schemaApplications",
  });
  if (!("schemaApplications" in result)) {
    throw new Error("Expected Schema Applications Projection");
  }
  return result.schemaApplications;
}

async function readSchemaFields(
  workspace: ProposalWorkspace,
  view: "origin" | "review",
): Promise<Readonly<Record<string, readonly string[]>>> {
  const result = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    view,
    section: "schemaFields",
  });
  if (!("schemaFields" in result)) {
    throw new Error("Expected Schema Fields Projection");
  }
  return result.schemaFields;
}

async function readDefinitionStatus(
  workspace: ProposalWorkspace,
  definitionId: string,
  view: "origin" | "review" = "origin",
) {
  const result = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    view,
    section: "definitionStatuses",
  });
  if (!("definitionStatuses" in result)) {
    throw new Error("Expected Definition Status Projection");
  }
  return result.definitionStatuses[definitionId];
}

async function readProjectionMap(
  workspace: ProposalWorkspace,
  view: "origin" | "review",
  section:
    "schemaExtensions" | "schemaSearchMembers" | "schemaExtensionConflicts" | "effectiveFields",
): Promise<Readonly<Record<string, unknown>>> {
  const result = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    view,
    section,
  });
  if (!("entries" in result) || result.section !== section) {
    throw new Error(`Expected ${section} Projection`);
  }
  return Object.fromEntries(result.entries.map((entry) => [entry.identity, entry.value]));
}

async function projectionEntries(
  workspace: ProposalWorkspace,
  section: "children" | "materializedFields",
): Promise<Readonly<Record<string, unknown>>> {
  const result = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    view: "origin",
    section,
    limit: 100,
  });
  if (!("entries" in result) || result.section !== section) {
    throw new Error(`Expected ${section} Projection`);
  }
  return Object.fromEntries(result.entries.map((entry) => [entry.identity, entry.value]));
}

async function expectMaterializedField(
  workspace: ProposalWorkspace,
  sourceSchemaIds: readonly string[],
): Promise<void> {
  const materialized = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    view: "origin",
    section: "materializedFields",
  });
  const effective = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    view: "origin",
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
    effective.effectiveFields.task?.map(
      ({ fieldDefinitionId, sourceSchemaIds, materializedFieldNodeId }) => ({
        fieldDefinitionId,
        sourceSchemaIds,
        materializedFieldNodeId,
      }),
    ),
  ).toEqual([
    {
      fieldDefinitionId: "status-field",
      sourceSchemaIds,
      materializedFieldNodeId: "status-on-task",
    },
  ]);
}

function schemaProgram(): readonly Mutation[] {
  return [
    ...["task", "project-schema", "work-schema", "status-field"].map((nodeId): Mutation => ({
      kind: "node-create",
      nodeId,
    })),
    {
      kind: "schema-field-add",
      schemaId: "project-schema",
      fieldDefinitionId: "status-field",
      anchor: end,
    },
    {
      kind: "schema-field-add",
      schemaId: "work-schema",
      fieldDefinitionId: "status-field",
      anchor: end,
    },
    { kind: "schema-apply", nodeId: "task", schemaId: "project-schema", anchor: end },
    { kind: "schema-apply", nodeId: "task", schemaId: "work-schema", anchor: end },
  ];
}
