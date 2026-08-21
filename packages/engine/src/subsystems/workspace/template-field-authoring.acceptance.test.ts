import { describe, expect, it } from "vitest";

import { admitAuthorityRecords } from "../../domain/admission/index.js";
import type { EditMutation } from "../../domain/edit/index.js";
import {
  templateFieldInstanceNodeId,
  templateFieldInstanceValueNodeId,
  workspaceSchemaNodeId,
  workspaceTrashNodeId,
} from "../../domain/fact/index.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import { InMemoryDocumentStore } from "../persistence/in-memory-document-store.js";
import {
  createSupertagApplication,
  removeSupertagApplication,
} from "../../../tests/support/workspace/edit-test-mutations.js";
import { createReplicaId, FactAuthority } from "./authority/fact-authority.js";
import { Workspace } from "./workspace.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("Supertag Template Field authoring", () => {
  it("authors a direct Template Field, makes it discoverable, adds it as optional, and copies a static default", async () => {
    const { workspace } = await open();
    expect((await mutate(workspace, "setup", setupNodes())).status).toBe("published");
    const created = await mutate(workspace, "create-template-field", [
      templateFieldCreation("task-supertag", "status-template", "status-definition"),
    ]);
    expect(created, JSON.stringify(created)).toMatchObject({ status: "published" });
    expect(await projection(workspace, "templateFields")).toMatchObject({
      templateFields: {
        "task-supertag": [
          {
            templateFieldNodeId: "status-template",
            fieldDefinitionId: "status-definition",
            staticDefaultValueNodeId: "status-default",
            fieldDefinitionOwner: "template-field",
          },
        ],
      },
    });
    expect(
      (await mutate(workspace, "author-static-default", [staticDefault("task-supertag", "status-template", "Ready")]))
        .status,
    ).toBe("published");
    expect(
      (await mutate(workspace, "apply-task-supertag", [createSupertagApplication("task", "task-supertag")])).status,
    ).toBe("published");
    const fields = await projection(workspace, "materializedFields");
    expect(fields.materializedFields.task?.[0]).toMatchObject({
      fieldDefinitionId: "status-definition",
      fieldNodeId: templateFieldInstanceNodeId("task", "status-template"),
    });
    const nodes = await projection(workspace, "nodes");
    expect(nodes.nodes[templateFieldInstanceValueNodeId("task", "status-template")]?.content).toMatchObject([
      { kind: "text", value: "Ready" },
    ]);
    expect(
      nodes.nodes["status-default"]?.content.map((item) => (item.kind === "text" ? item.value : "")).join(""),
    ).toBe("Ready");

    const discoverable = await mutate(workspace, "make-discoverable", [
      {
        kind: "supertag-template-field-make-discoverable",
        supertagId: "task-supertag",
        templateFieldNodeId: "status-template",
        fieldDefinitionId: "status-definition",
      },
    ]);
    expect(discoverable, JSON.stringify(discoverable)).toMatchObject({ status: "published" });
    const owners = await projection(workspace, "nodeOwners");
    expect(owners.nodeOwners["status-definition"]).toBe(workspaceSchemaNodeId("workspace"));

    const optional = await mutate(workspace, "add-existing-field", [
      {
        kind: "supertag-optional-field-contribution-add",
        supertagId: "other-supertag",
        metanodeId: "other-supertag-metanode",
        fieldNurseryNodeId: "other-fields",
        fieldNurseryOccurrenceId: "other-fields-occurrence",
        nurseryDefinitionOccurrenceId: "other-fields-definition",
        nurseryValueNodeId: "other-fields-value",
        nurseryValueOccurrenceId: "other-fields-value-occurrence",
        contributionNodeId: "other-status-contribution",
        contributionOccurrenceId: "other-status-contribution-occurrence",
        fieldDefinitionId: "status-definition",
        definitionOccurrenceId: "other-status-definition",
        valueNodeId: "other-status-value",
        valueOccurrenceId: "other-status-value-occurrence",
        anchor: end,
      },
    ]);
    expect(optional, JSON.stringify(optional)).toMatchObject({ status: "published" });
    expect(await projection(workspace, "optionalFieldContributions")).toMatchObject({
      optionalFieldContributions: {
        "other-supertag": [{ contributionNodeId: "other-status-contribution", fieldDefinitionId: "status-definition" }],
      },
    });
  });

  it("reviews and accepts public Template Field creation as one composite transaction", async () => {
    const { workspace } = await open();
    expect((await mutate(workspace, "proposal-setup", setupNodes())).status).toBe("published");
    expect(
      await mutate(
        workspace,
        "propose-template-field",
        [templateFieldCreation("task-supertag", "status-template", "status-definition")],
        "proposal",
      ),
    ).toMatchObject({ status: "published" });
    expect((await projection(workspace, "templateFields", "origin")).templateFields["task-supertag"]).toBeUndefined();
    expect(
      (await projection(workspace, "templateFields", "review")).templateFields["task-supertag"]?.[0],
    ).toMatchObject({
      templateFieldNodeId: "status-template",
      fieldDefinitionId: "status-definition",
    });
    const review = await workspace.query({ kind: "review", workspaceId: "workspace" });
    const hunk = "hunks" in review ? review.hunks[0] : undefined;
    if (hunk === undefined) {
      throw new Error("Expected Template Field creation Review Hunk");
    }
    expect(
      await workspace.execute({
        kind: "resolve-review",
        workspaceId: "workspace",
        invocationId: "accept-template-field",
        actorId: "reviewer",
        decision: "accept",
        selection: hunk.selection,
      }),
    ).toMatchObject({ status: "published" });
    expect(
      (await projection(workspace, "templateFields", "origin")).templateFields["task-supertag"]?.[0],
    ).toMatchObject({
      templateFieldNodeId: "status-template",
      fieldDefinitionId: "status-definition",
    });
  });

  it("reviews a new Template Field use of one discoverable Field Definition", async () => {
    const { workspace } = await open();
    expect((await mutate(workspace, "proposal-existing-setup", setupNodes())).status).toBe("published");
    expect(
      await mutate(workspace, "proposal-existing-create", [
        templateFieldCreation("task-supertag", "status-template", "status-definition"),
      ]),
    ).toMatchObject({ status: "published" });
    expect(
      await mutate(workspace, "proposal-existing-discoverable", [
        {
          kind: "supertag-template-field-make-discoverable",
          supertagId: "task-supertag",
          templateFieldNodeId: "status-template",
          fieldDefinitionId: "status-definition",
        },
      ]),
    ).toMatchObject({ status: "published" });

    expect(
      await mutate(
        workspace,
        "propose-existing-template-field",
        [existingTemplateField("other-supertag", "other-status-template", "status-definition")],
        "proposal",
      ),
    ).toMatchObject({ status: "published" });
    expect((await projection(workspace, "templateFields", "origin")).templateFields["other-supertag"]).toBeUndefined();
    expect(
      (await projection(workspace, "templateFields", "review")).templateFields["other-supertag"]?.[0],
    ).toMatchObject({
      templateFieldNodeId: "other-status-template",
      fieldDefinitionId: "status-definition",
      fieldDefinitionOwner: "workspace-schema",
    });
    const review = await workspace.query({ kind: "review", workspaceId: "workspace" });
    const hunk = "hunks" in review ? review.hunks[0] : undefined;
    if (hunk === undefined) {
      throw new Error("Expected add-existing Template Field Review Hunk");
    }
    expect(
      await workspace.execute({
        kind: "resolve-review",
        workspaceId: "workspace",
        invocationId: "accept-existing-template-field",
        actorId: "reviewer",
        decision: "accept",
        selection: hunk.selection,
      }),
    ).toMatchObject({ status: "published" });
    expect(
      (await projection(workspace, "templateFields", "origin")).templateFields["other-supertag"]?.[0],
    ).toMatchObject({
      templateFieldNodeId: "other-status-template",
      fieldDefinitionId: "status-definition",
    });
    expect((await projection(workspace, "nodeOwners")).nodeOwners["status-definition"]).toBe(
      workspaceSchemaNodeId("workspace"),
    );
  });

  it("rejects non-discoverable endpoints, duplicate exposure, and reused relation identities", async () => {
    const { workspace } = await open();
    expect((await mutate(workspace, "negative-setup", setupNodes())).status).toBe("published");
    expect(
      await mutate(workspace, "negative-create", [
        templateFieldCreation("task-supertag", "status-template", "status-definition"),
      ]),
    ).toMatchObject({ status: "published" });

    expect(
      await mutate(workspace, "non-discoverable-existing", [
        existingTemplateField("other-supertag", "other-status-template", "status-definition"),
      ]),
    ).toMatchObject({
      status: "rejected",
      error: { message: "Template Field endpoint is not a discoverable Field Definition" },
    });

    expect(
      await mutate(workspace, "negative-discoverable", [
        {
          kind: "supertag-template-field-make-discoverable",
          supertagId: "task-supertag",
          templateFieldNodeId: "status-template",
          fieldDefinitionId: "status-definition",
        },
      ]),
    ).toMatchObject({ status: "published" });
    expect(
      await mutate(workspace, "duplicate-exposure", [
        existingTemplateField("task-supertag", "duplicate-status-template", "status-definition"),
      ]),
    ).toMatchObject({
      status: "rejected",
      error: { message: "Supertag already exposes this Field Definition" },
    });
    expect(
      await mutate(workspace, "reused-identity", [
        existingTemplateField("other-supertag", "status-template", "status-definition"),
      ]),
    ).toMatchObject({
      status: "rejected",
      error: { message: "Template Field Node or Occurrence identity already exists" },
    });
  });

  it("does not let discoverability authorization carry an Intrinsic Node Type rewrite", async () => {
    const { facts, workspace } = await open();
    expect((await mutate(workspace, "setup", setupNodes())).status).toBe("published");
    const created = await mutate(workspace, "create-template-field", [
      templateFieldCreation("task-supertag", "status-template", "status-definition"),
    ]);
    expect(created, JSON.stringify(created)).toMatchObject({ status: "published" });

    await expect(
      facts.commit({
        invocationId: "smuggle-type-rewrite",
        request: { command: "smuggle-type-rewrite" },
        writes: [
          {
            kind: "transaction",
            bodies: [
              {
                kind: "contribution",
                actorId: "remote",
                intent: "direct",
                mutation: {
                  kind: "supertag-template-field-discoverability-set",
                  supertagId: "task-supertag",
                  templateFieldNodeId: "status-template",
                  fieldDefinitionId: "status-definition",
                  discoverable: true,
                  previousDiscoverable: false,
                },
              },
              {
                kind: "contribution",
                actorId: "remote",
                intent: "direct",
                mutation: {
                  kind: "node-owner-set",
                  nodeId: "status-definition",
                  ownerNodeId: workspaceSchemaNodeId("workspace"),
                  previousOwnerNodeId: "status-template",
                },
              },
              {
                kind: "contribution",
                actorId: "remote",
                intent: "direct",
                mutation: {
                  kind: "intrinsic-node-type-declare",
                  nodeId: "status-definition",
                  intrinsicNodeType: "supertag-definition",
                },
              },
              {
                kind: "contribution",
                actorId: "remote",
                intent: "direct",
                mutation: {
                  kind: "intrinsic-node-type-declare",
                  nodeId: "status-definition",
                  intrinsicNodeType: "field-definition",
                },
              },
            ],
          },
        ],
        lineage: null,
        publishedFrontier: facts.snapshot().frontier,
      }),
    ).rejects.toThrow(/Structural role requires a typed mutation: Intrinsic Node Type status-definition/);
    const nodes = await projection(workspace, "nodes");
    expect(nodes.nodes["status-definition"]?.intrinsicNodeType).toBe("field-definition");
  });

  it("TEMPLATE-FIELD-3 sets, modifies, clears, reviews, restores, and restarts one stable Static Default slot", async () => {
    const documents = new InMemoryDocumentStore();
    const { workspace } = await open(documents, "721");
    expect(
      (
        await mutate(workspace, "static-default-setup", [
          ...setupNodes(),
          nodeAt("alpha-instance", "workspace"),
          nodeAt("beta-instance", "workspace"),
          nodeAt("empty-instance", "workspace"),
        ])
      ).status,
    ).toBe("published");
    expect(
      await mutate(workspace, "static-default-field", [
        templateFieldCreation("task-supertag", "status-template", "status-definition"),
      ]),
    ).toMatchObject({ status: "published" });

    const alphaDefault = await mutate(workspace, "static-default-alpha", [
      staticDefault("task-supertag", "status-template", "Alpha"),
    ]);
    expect(alphaDefault, JSON.stringify(alphaDefault)).toMatchObject({ status: "published" });
    expect(
      await mutate(workspace, "static-default-alpha-instance", [
        createSupertagApplication("alpha-instance", "task-supertag"),
      ]),
    ).toMatchObject({ status: "published" });

    expect(
      await mutate(workspace, "static-default-beta", [staticDefault("task-supertag", "status-template", "Beta")]),
    ).toMatchObject({ status: "published" });
    let nodes = await projection(workspace, "nodes");
    expect(nodeText(nodes.nodes["status-default"])).toBe("Beta");
    expect(nodeText(nodes.nodes[templateFieldInstanceValueNodeId("alpha-instance", "status-template")])).toBe("Alpha");
    expect(
      await mutate(workspace, "static-default-beta-instance", [
        createSupertagApplication("beta-instance", "task-supertag"),
      ]),
    ).toMatchObject({ status: "published" });
    nodes = await projection(workspace, "nodes");
    expect(nodeText(nodes.nodes[templateFieldInstanceValueNodeId("beta-instance", "status-template")])).toBe("Beta");

    expect(
      await mutate(
        workspace,
        "static-default-clear-proposal",
        [staticDefault("task-supertag", "status-template", "")],
        "proposal",
      ),
    ).toMatchObject({ status: "published" });
    expect(nodeText((await projection(workspace, "nodes", "origin")).nodes["status-default"])).toBe("Beta");
    expect(nodeText((await projection(workspace, "nodes", "review")).nodes["status-default"])).toBe("");
    const review = await workspace.query({ kind: "review", workspaceId: "workspace" });
    const clearHunk =
      "hunks" in review
        ? review.hunks.find((hunk) =>
            hunk.selection.evidence.effects.some(
              (effect) => effect.kind === "text" && effect.nodeId === "status-default",
            ),
          )
        : undefined;
    if (clearHunk === undefined) {
      throw new Error("Expected Static Default text Review Hunk");
    }
    expect(
      await workspace.execute({
        kind: "resolve-review",
        workspaceId: "workspace",
        invocationId: "static-default-clear-accept",
        actorId: "reviewer",
        decision: "accept",
        selection: clearHunk.selection,
      }),
    ).toMatchObject({ status: "published" });
    expect(nodeText((await projection(workspace, "nodes")).nodes["status-default"])).toBe("");

    expect(
      await mutate(workspace, "static-default-history-beta", [
        staticDefault("task-supertag", "status-template", "Beta"),
      ]),
    ).toMatchObject({ status: "published" });
    expect(
      await mutate(workspace, "static-default-history-clear", [staticDefault("task-supertag", "status-template", "")]),
    ).toMatchObject({ status: "published" });

    const history = await workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "template-fields",
    });
    if (!("undo" in history) || history.undo === null) {
      throw new Error("Expected Static Default clear Undo");
    }
    expect(
      await workspace.execute({
        kind: "undo",
        workspaceId: "workspace",
        invocationId: "static-default-clear-undo",
        actorId: "actor",
        selection: history.undo,
      }),
    ).toMatchObject({ status: "published" });
    expect(nodeText((await projection(workspace, "nodes")).nodes["status-default"])).toBe("Beta");
    const afterUndo = await workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "template-fields",
    });
    if (!("redo" in afterUndo) || afterUndo.redo === null) {
      throw new Error("Expected Static Default clear Redo");
    }
    expect(
      await workspace.execute({
        kind: "redo",
        workspaceId: "workspace",
        invocationId: "static-default-clear-redo",
        actorId: "actor",
        selection: afterUndo.redo,
      }),
    ).toMatchObject({ status: "published" });

    expect(
      await mutate(workspace, "static-default-empty-instance", [
        createSupertagApplication("empty-instance", "task-supertag"),
      ]),
    ).toMatchObject({ status: "published" });
    expect((await projection(workspace, "materializedFields")).materializedFields["empty-instance"]).toBeUndefined();
    expect((await projection(workspace, "effectiveFields")).effectiveFields["empty-instance"]?.[0]).toMatchObject({
      fieldDefinitionId: "status-definition",
      materializedFieldNodeId: null,
    });
    expect(nodeText((await projection(workspace, "nodes")).nodes["status-default"])).toBe("");
    expect(
      await mutate(workspace, "static-default-noop", [staticDefault("task-supertag", "status-template", "")]),
    ).toMatchObject({
      status: "rejected",
      error: { message: "Template Field already has this Static Default" },
    });

    await workspace.close();
    const restarted = await open(documents, "722");
    const restartedNodes = await projection(restarted.workspace, "nodes");
    expect(nodeText(restartedNodes.nodes["status-default"])).toBe("");
    expect(nodeText(restartedNodes.nodes[templateFieldInstanceValueNodeId("alpha-instance", "status-template")])).toBe(
      "Alpha",
    );
    expect(nodeText(restartedNodes.nodes[templateFieldInstanceValueNodeId("beta-instance", "status-template")])).toBe(
      "Beta",
    );
    expect(
      (await projection(restarted.workspace, "materializedFields")).materializedFields["empty-instance"],
    ).toBeUndefined();
    expect(
      (await projection(restarted.workspace, "templateFields")).templateFields["task-supertag"]?.[0],
    ).toMatchObject({
      templateFieldNodeId: "status-template",
      staticDefaultValueNodeId: "status-default",
    });
  });

  it("TEMPLATE-FIELD-1 trashes a removed use, restores it through History, and re-adds the same Definition as a new use", async () => {
    const documents = new InMemoryDocumentStore();
    const { workspace } = await open(documents, "701");
    expect((await mutate(workspace, "setup", setupNodes())).status).toBe("published");
    expect(
      await mutate(workspace, "create-template-field", [
        templateFieldCreation("task-supertag", "status-template", "status-definition"),
      ]),
    ).toMatchObject({ status: "published" });
    expect(
      await mutate(workspace, "make-discoverable", [
        {
          kind: "supertag-template-field-make-discoverable",
          supertagId: "task-supertag",
          templateFieldNodeId: "status-template",
          fieldDefinitionId: "status-definition",
        },
      ]),
    ).toMatchObject({ status: "published" });
    expect(
      await mutate(workspace, "apply-template-field-host", [createSupertagApplication("task", "task-supertag")]),
    ).toMatchObject({ status: "published" });
    expect((await projection(workspace, "effectiveFields")).effectiveFields.task?.[0]).toMatchObject({
      fieldDefinitionId: "status-definition",
      sources: [{ kind: "template", templateFieldNodeId: "status-template" }],
    });
    expect(
      await mutate(workspace, "remove-template-field", [
        {
          kind: "supertag-template-field-remove",
          supertagId: "task-supertag",
          templateFieldNodeId: "status-template",
        },
      ]),
    ).toMatchObject({ status: "published" });
    expect((await projection(workspace, "templateFields")).templateFields["task-supertag"]).toBeUndefined();
    const detachedOwners = await projection(workspace, "nodeOwners");
    expect(detachedOwners.nodeOwners["status-template"]).toBe(workspaceTrashNodeId("workspace"));
    expect(detachedOwners.nodeOwners["status-definition"]).toBe(workspaceSchemaNodeId("workspace"));
    expect((await projection(workspace, "occurrences")).occurrences["status-template-occurrence"]).toMatchObject({
      nodeId: "status-template",
      parentNodeId: workspaceTrashNodeId("workspace"),
    });
    expect((await projection(workspace, "effectiveFields")).effectiveFields.task).toEqual([]);

    const history = await workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "template-fields",
    });
    if (!("undo" in history) || history.undo === null) {
      throw new Error("Expected Template Field removal Undo");
    }
    const undone = await workspace.execute({
      kind: "undo",
      workspaceId: "workspace",
      invocationId: "undo-template-field-removal",
      actorId: "actor",
      selection: history.undo,
    });
    expect(undone, JSON.stringify(undone)).toMatchObject({ status: "published" });
    expect((await projection(workspace, "templateFields")).templateFields["task-supertag"]?.[0]).toMatchObject({
      templateFieldNodeId: "status-template",
      fieldDefinitionOwner: "workspace-schema",
    });
    expect((await projection(workspace, "nodeOwners")).nodeOwners["status-template"]).toBe("task-supertag");

    const afterUndo = await workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "template-fields",
    });
    if (!("redo" in afterUndo) || afterUndo.redo === null) {
      throw new Error("Expected Template Field removal Redo");
    }
    expect(
      await workspace.execute({
        kind: "redo",
        workspaceId: "workspace",
        invocationId: "redo-template-field-removal",
        actorId: "actor",
        selection: afterUndo.redo,
      }),
    ).toMatchObject({ status: "published" });
    expect((await projection(workspace, "nodeOwners")).nodeOwners["status-template"]).toBe(
      workspaceTrashNodeId("workspace"),
    );

    expect(
      await mutate(workspace, "re-add-existing-template-field", [
        existingTemplateField("task-supertag", "status-template-readded", "status-definition"),
      ]),
    ).toMatchObject({ status: "published" });
    expect((await projection(workspace, "templateFields")).templateFields["task-supertag"]).toEqual([
      expect.objectContaining({
        templateFieldNodeId: "status-template-readded",
        fieldDefinitionId: "status-definition",
        staticDefaultValueNodeId: "status-template-readded-default",
        fieldDefinitionOwner: "workspace-schema",
      }),
    ]);
    const readdedOwners = await projection(workspace, "nodeOwners");
    expect(readdedOwners.nodeOwners["status-template"]).toBe(workspaceTrashNodeId("workspace"));
    expect(readdedOwners.nodeOwners["status-template-readded"]).toBe("task-supertag");
    expect(readdedOwners.nodeOwners["status-definition"]).toBe(workspaceSchemaNodeId("workspace"));
    expect((await projection(workspace, "effectiveFields")).effectiveFields.task?.[0]).toMatchObject({
      fieldDefinitionId: "status-definition",
      sources: [{ kind: "template", templateFieldNodeId: "status-template-readded" }],
    });

    await workspace.close();
    const restarted = await open(documents, "702");
    expect(
      (await projection(restarted.workspace, "templateFields")).templateFields["task-supertag"]?.[0],
    ).toMatchObject({
      templateFieldNodeId: "status-template-readded",
      fieldDefinitionId: "status-definition",
    });
    expect((await projection(restarted.workspace, "nodeOwners")).nodeOwners["status-template"]).toBe(
      workspaceTrashNodeId("workspace"),
    );
  });

  it("TEMPLATE-FIELD-2 projects pinned fields, optional suggestions, and authored empty content across source removal", async () => {
    const documents = new InMemoryDocumentStore();
    const { workspace } = await open(documents, "711");
    expect((await mutate(workspace, "visibility-setup", setupNodes())).status).toBe("published");
    expect(
      await mutate(workspace, "visibility-field", [
        templateFieldCreation("task-supertag", "status-template", "status-definition"),
      ]),
    ).toMatchObject({ status: "published" });
    expect(
      await mutate(workspace, "visibility-discoverable", [
        {
          kind: "supertag-template-field-make-discoverable",
          supertagId: "task-supertag",
          templateFieldNodeId: "status-template",
          fieldDefinitionId: "status-definition",
        },
      ]),
    ).toMatchObject({ status: "published" });
    expect(
      await mutate(workspace, "visibility-optional", [optionalField("other-supertag", "status-definition")]),
    ).toMatchObject({ status: "published" });
    expect(
      await mutate(workspace, "visibility-apply-normal", [createSupertagApplication("task", "task-supertag")]),
    ).toMatchObject({ status: "published" });
    expect(
      await mutate(workspace, "visibility-apply-optional", [createSupertagApplication("task", "other-supertag", "2")]),
    ).toMatchObject({ status: "published" });

    expect((await projection(workspace, "effectiveFields")).effectiveFields.task).toEqual([
      expect.objectContaining({
        fieldDefinitionId: "status-definition",
        sources: [
          expect.objectContaining({ kind: "template", templateFieldNodeId: "status-template" }),
          expect.objectContaining({ kind: "optional", optionalContributionNodeId: "other-status-contribution" }),
        ],
        visibility: "normal",
        visibilityConflicted: false,
      }),
    ]);
    expect((await projection(workspace, "optionalFieldSuggestions")).optionalFieldSuggestions.task).toEqual([]);

    expect(
      await mutate(
        workspace,
        "visibility-proposal",
        [
          {
            kind: "supertag-template-field-visibility-set",
            supertagId: "task-supertag",
            templateFieldNodeId: "status-template",
            visibility: "pinned",
          },
        ],
        "proposal",
      ),
    ).toMatchObject({ status: "published" });
    expect(
      (await projection(workspace, "templateFields", "origin")).templateFields["task-supertag"]?.[0],
    ).toMatchObject({ visibility: "normal" });
    expect(
      (await projection(workspace, "templateFields", "review")).templateFields["task-supertag"]?.[0],
    ).toMatchObject({ visibility: "pinned" });
    const review = await workspace.query({ kind: "review", workspaceId: "workspace" });
    const visibilityHunk = "hunks" in review ? review.hunks[0] : undefined;
    if (visibilityHunk === undefined) {
      throw new Error("Expected Template Field visibility Review Hunk");
    }
    expect(visibilityHunk.selection.evidence.effects).toContainEqual({
      kind: "supertag-relation",
      relation: "template-field-visibility",
      ownerId: "task-supertag",
      targetId: "status-template",
      originIndex: 0,
      reviewIndex: 1,
    });
    const visibilityAccepted = await workspace.execute({
      kind: "resolve-review",
      workspaceId: "workspace",
      invocationId: "visibility-accept",
      actorId: "reviewer",
      decision: "accept",
      selection: visibilityHunk.selection,
    });
    expect(visibilityAccepted, JSON.stringify(visibilityAccepted)).toMatchObject({ status: "published" });
    expect((await projection(workspace, "effectiveFields")).effectiveFields.task?.[0]).toMatchObject({
      visibility: "pinned",
    });

    expect(
      await mutate(workspace, "visibility-normal", [
        {
          kind: "supertag-template-field-visibility-set",
          supertagId: "task-supertag",
          templateFieldNodeId: "status-template",
          visibility: "normal",
        },
      ]),
    ).toMatchObject({ status: "published" });
    const history = await workspace.query({ kind: "history", workspaceId: "workspace", channelId: "template-fields" });
    if (!("undo" in history) || history.undo === null) {
      throw new Error("Expected Template Field visibility Undo");
    }
    const visibilityUndone = await workspace.execute({
      kind: "undo",
      workspaceId: "workspace",
      invocationId: "visibility-undo",
      actorId: "actor",
      selection: history.undo,
    });
    expect(visibilityUndone, JSON.stringify(visibilityUndone)).toMatchObject({ status: "published" });
    expect((await projection(workspace, "templateFields")).templateFields["task-supertag"]?.[0]).toMatchObject({
      visibility: "pinned",
    });
    const afterUndo = await workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "template-fields",
    });
    if (!("redo" in afterUndo) || afterUndo.redo === null) {
      throw new Error("Expected Template Field visibility Redo");
    }
    expect(
      await workspace.execute({
        kind: "redo",
        workspaceId: "workspace",
        invocationId: "visibility-redo",
        actorId: "actor",
        selection: afterUndo.redo,
      }),
    ).toMatchObject({ status: "published" });
    expect((await projection(workspace, "templateFields")).templateFields["task-supertag"]?.[0]).toMatchObject({
      visibility: "normal",
    });

    expect(
      await mutate(workspace, "visibility-remove-normal-source", [removeSupertagApplication("task", "task-supertag")]),
    ).toMatchObject({ status: "published" });
    expect((await projection(workspace, "effectiveFields")).effectiveFields.task).toEqual([]);
    expect((await projection(workspace, "optionalFieldSuggestions")).optionalFieldSuggestions.task).toEqual([
      {
        ownerNodeId: "task",
        fieldDefinitionId: "status-definition",
        sources: [
          {
            kind: "optional",
            applicationNodeId: "task-supertag-application-other-supertag-2",
            appliedSupertagId: "other-supertag",
            sourceSupertagId: "other-supertag",
            extensionPath: ["other-supertag"],
            optionalContributionNodeId: "other-status-contribution",
          },
        ],
      },
    ]);

    expect(
      await mutate(workspace, "visibility-materialize-empty", [
        {
          kind: "field-materialize",
          ownerNodeId: "task",
          fieldDefinitionId: "status-definition",
          fieldNodeId: "task-status-field",
          fieldOccurrenceId: "task-status-field-occurrence",
        },
      ]),
    ).toMatchObject({ status: "published" });
    expect((await projection(workspace, "optionalFieldSuggestions")).optionalFieldSuggestions.task).toEqual([]);
    expect((await projection(workspace, "materializedFields")).materializedFields.task).toEqual([
      expect.objectContaining({
        fieldDefinitionId: "status-definition",
        fieldNodeId: "task-status-field",
        valueOccurrenceIds: [],
      }),
    ]);

    expect(
      await mutate(workspace, "visibility-remove-optional-source", [
        removeSupertagApplication("task", "other-supertag", "2"),
      ]),
    ).toMatchObject({ status: "published" });
    expect((await projection(workspace, "effectiveFields")).effectiveFields.task).toBeUndefined();
    expect((await projection(workspace, "optionalFieldSuggestions")).optionalFieldSuggestions.task).toBeUndefined();
    expect((await projection(workspace, "materializedFields")).materializedFields.task?.[0]).toMatchObject({
      fieldNodeId: "task-status-field",
      valueOccurrenceIds: [],
    });

    await workspace.close();
    const restarted = await open(documents, "712");
    expect((await projection(restarted.workspace, "materializedFields")).materializedFields.task?.[0]).toMatchObject({
      fieldNodeId: "task-status-field",
      valueOccurrenceIds: [],
    });
    expect(
      (await projection(restarted.workspace, "optionalFieldSuggestions")).optionalFieldSuggestions.task,
    ).toBeUndefined();
  });

  it("merges two Extension sources by Definition and preserves authored Field content after the last source is removed", async () => {
    const documents = new InMemoryDocumentStore();
    const { workspace } = await open(documents, "731");
    expect(
      (
        await mutate(workspace, "composition-setup", [
          ...setupNodes(),
          nodeAt("target-supertag", "workspace", "supertag-definition"),
        ])
      ).status,
    ).toBe("published");
    expect(
      await mutate(workspace, "composition-source-a", [
        templateFieldCreation("task-supertag", "source-a-template", "status-definition"),
      ]),
    ).toMatchObject({ status: "published" });
    expect(
      await mutate(workspace, "composition-discoverable", [
        {
          kind: "supertag-template-field-make-discoverable",
          supertagId: "task-supertag",
          templateFieldNodeId: "source-a-template",
          fieldDefinitionId: "status-definition",
        },
      ]),
    ).toMatchObject({ status: "published" });
    expect(
      await mutate(workspace, "composition-source-b", [
        existingTemplateField("other-supertag", "source-b-template", "status-definition"),
        {
          kind: "supertag-template-field-visibility-set",
          supertagId: "other-supertag",
          templateFieldNodeId: "source-b-template",
          visibility: "pinned",
        },
      ]),
    ).toMatchObject({ status: "published" });
    expect(
      await mutate(workspace, "composition-extensions", [
        extensionAdd("target-supertag", "task-supertag"),
        extensionAdd("target-supertag", "other-supertag"),
        createSupertagApplication("task", "target-supertag"),
      ]),
    ).toMatchObject({ status: "published" });

    expect((await projection(workspace, "effectiveFields")).effectiveFields.task).toEqual([
      {
        ownerNodeId: "task",
        fieldDefinitionId: "status-definition",
        sources: [
          {
            kind: "template",
            applicationNodeId: "task-supertag-application-target-supertag-1",
            appliedSupertagId: "target-supertag",
            sourceSupertagId: "task-supertag",
            extensionPath: ["target-supertag", "task-supertag"],
            templateFieldNodeId: "source-a-template",
            staticDefaultValueNodeId: "status-default",
            visibility: "normal",
          },
          {
            kind: "template",
            applicationNodeId: "task-supertag-application-target-supertag-1",
            appliedSupertagId: "target-supertag",
            sourceSupertagId: "other-supertag",
            extensionPath: ["target-supertag", "other-supertag"],
            templateFieldNodeId: "source-b-template",
            staticDefaultValueNodeId: "source-b-template-default",
            visibility: "pinned",
          },
        ],
        staticDefault: { state: "none", candidates: [] },
        visibility: "pinned",
        materializedFieldNodeId: null,
        visibilityConflicted: false,
      },
    ]);

    const removedA = await mutate(workspace, "composition-remove-a", [
      extensionRemove("target-supertag", "task-supertag"),
    ]);
    if (removedA.status !== "published") {
      throw new Error(JSON.stringify(removedA));
    }
    expect((await projection(workspace, "effectiveFields")).effectiveFields.task?.[0]?.sources).toEqual([
      expect.objectContaining({ sourceSupertagId: "other-supertag" }),
    ]);
    const removalHistory = await workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "template-fields",
    });
    if (!("undo" in removalHistory) || removalHistory.undo === null) {
      throw new Error("Expected Extension source removal Undo");
    }
    expect(
      await workspace.execute({
        kind: "undo",
        workspaceId: "workspace",
        invocationId: "composition-remove-a-undo",
        actorId: "actor",
        selection: removalHistory.undo,
      }),
    ).toMatchObject({ status: "published" });
    expect((await projection(workspace, "effectiveFields")).effectiveFields.task?.[0]?.sources).toHaveLength(2);
    const afterUndo = await workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "template-fields",
    });
    if (!("redo" in afterUndo) || afterUndo.redo === null) {
      throw new Error("Expected Extension source removal Redo");
    }
    expect(
      await workspace.execute({
        kind: "redo",
        workspaceId: "workspace",
        invocationId: "composition-remove-a-redo",
        actorId: "actor",
        selection: afterUndo.redo,
      }),
    ).toMatchObject({ status: "published" });

    expect(
      await mutate(workspace, "composition-materialize-field", [
        {
          kind: "field-materialize",
          ownerNodeId: "task",
          fieldDefinitionId: "status-definition",
          fieldNodeId: "task-status-field",
          fieldOccurrenceId: "task-status-field-occurrence",
        },
      ]),
    ).toMatchObject({ status: "published" });
    expect(
      await mutate(workspace, "composition-author-field", [
        {
          kind: "node-create",
          nodeId: "task-status-value",
          occurrenceId: "task-status-value-original",
          parentNodeId: "task-status-field",
          anchor: end,
          seed: { text: [{ value: "Authored value", attributes: {} }] },
        },
      ]),
    ).toMatchObject({ status: "published" });
    expect(
      await mutate(
        workspace,
        "composition-remove-last-source",
        [extensionRemove("target-supertag", "other-supertag")],
        "proposal",
      ),
    ).toMatchObject({ status: "published" });
    expect((await projection(workspace, "effectiveFields", "origin")).effectiveFields.task).toHaveLength(1);
    expect((await projection(workspace, "effectiveFields", "review")).effectiveFields.task).toEqual([]);
    expect((await projection(workspace, "materializedFields", "review")).materializedFields.task?.[0]).toMatchObject({
      fieldNodeId: "task-status-field",
      valueOccurrenceIds: ["task-status-value-original"],
    });
    const review = await workspace.query({ kind: "review", workspaceId: "workspace" });
    const sourceRemovalHunk =
      "hunks" in review
        ? review.hunks.find((hunk) =>
            hunk.selection.evidence.effects.some(
              (effect) =>
                effect.kind === "supertag-relation" &&
                effect.ownerId === "target-supertag" &&
                effect.targetId === "other-supertag",
            ),
          )
        : undefined;
    if (sourceRemovalHunk === undefined) {
      throw new Error("Expected Extension source removal Review Hunk");
    }
    expect(
      await workspace.execute({
        kind: "resolve-review",
        workspaceId: "workspace",
        invocationId: "composition-remove-last-source-accept",
        actorId: "reviewer",
        decision: "accept",
        selection: sourceRemovalHunk.selection,
      }),
    ).toMatchObject({ status: "published" });
    expect((await projection(workspace, "effectiveFields")).effectiveFields.task).toEqual([]);
    expect((await projection(workspace, "materializedFields")).materializedFields.task?.[0]).toMatchObject({
      fieldNodeId: "task-status-field",
      valueOccurrenceIds: ["task-status-value-original"],
    });

    await workspace.close();
    const restarted = await open(documents, "732");
    expect((await projection(restarted.workspace, "effectiveFields")).effectiveFields.task).toEqual([]);
    expect((await projection(restarted.workspace, "materializedFields")).materializedFields.task?.[0]).toMatchObject({
      fieldNodeId: "task-status-field",
      valueOccurrenceIds: ["task-status-value-original"],
    });
    expect(nodeText((await projection(restarted.workspace, "nodes")).nodes["task-status-value"])).toBe(
      "Authored value",
    );
  });

  it("resolves chain defaults by specificity and surfaces incomparable defaults without an order winner", async () => {
    const { workspace } = await open(new InMemoryDocumentStore(), "741");
    expect(
      (
        await mutate(workspace, "default-composition-setup", [
          ...setupNodes(),
          nodeAt("derived-supertag", "workspace", "supertag-definition"),
          nodeAt("conflict-supertag", "workspace", "supertag-definition"),
          nodeAt("chain-instance", "workspace"),
          nodeAt("conflict-instance", "workspace"),
          nodeAt("same-default-instance", "workspace"),
        ])
      ).status,
    ).toBe("published");
    expect(
      await mutate(workspace, "default-composition-fields", [
        templateFieldCreation("task-supertag", "base-template", "status-definition"),
      ]),
    ).toMatchObject({ status: "published" });
    expect(
      await mutate(workspace, "default-composition-discoverable", [
        {
          kind: "supertag-template-field-make-discoverable",
          supertagId: "task-supertag",
          templateFieldNodeId: "base-template",
          fieldDefinitionId: "status-definition",
        },
      ]),
    ).toMatchObject({ status: "published" });
    expect(
      await mutate(workspace, "default-composition-other-fields", [
        existingTemplateField("derived-supertag", "derived-template", "status-definition"),
        existingTemplateField("other-supertag", "other-template", "status-definition"),
        staticDefault("task-supertag", "base-template", "Base"),
        staticDefault("derived-supertag", "derived-template", "Derived"),
        staticDefault("other-supertag", "other-template", "Other"),
        extensionAdd("derived-supertag", "task-supertag"),
        extensionAdd("conflict-supertag", "task-supertag"),
        extensionAdd("conflict-supertag", "other-supertag"),
      ]),
    ).toMatchObject({ status: "published" });
    const authoredDefaults = await projection(workspace, "nodes");
    expect(nodeText(authoredDefaults.nodes["status-default"])).toBe("Base");
    expect(nodeText(authoredDefaults.nodes["derived-template-default"])).toBe("Derived");
    expect(
      await mutate(workspace, "default-chain-application", [
        createSupertagApplication("chain-instance", "derived-supertag"),
      ]),
    ).toMatchObject({ status: "published" });
    expect(
      nodeText(
        (await projection(workspace, "nodes")).nodes[
          templateFieldInstanceValueNodeId("chain-instance", "derived-template")
        ],
      ),
    ).toBe("Derived");
    expect(
      (await projection(workspace, "effectiveFields")).effectiveFields["chain-instance"]?.[0]?.staticDefault,
    ).toEqual({
      state: "value",
      value: "Derived",
      sourceTemplateFieldNodeId: "derived-template",
      candidates: [{ value: "Derived", sourceTemplateFieldNodeIds: ["derived-template"] }],
    });

    expect(
      await mutate(workspace, "default-conflict-application", [
        createSupertagApplication("conflict-instance", "conflict-supertag"),
      ]),
    ).toMatchObject({ status: "published" });
    expect((await projection(workspace, "materializedFields")).materializedFields["conflict-instance"]).toBeUndefined();
    expect(
      (await projection(workspace, "effectiveFields")).effectiveFields["conflict-instance"]?.[0]?.staticDefault,
    ).toEqual({
      state: "conflict",
      candidates: [
        { value: "Base", sourceTemplateFieldNodeIds: ["base-template"] },
        { value: "Other", sourceTemplateFieldNodeIds: ["other-template"] },
      ],
    });

    expect(
      await mutate(workspace, "default-same-value", [
        staticDefault("other-supertag", "other-template", "Base"),
        createSupertagApplication("same-default-instance", "conflict-supertag"),
      ]),
    ).toMatchObject({ status: "published" });
    expect(
      (await projection(workspace, "effectiveFields")).effectiveFields["same-default-instance"]?.[0]?.staticDefault,
    ).toEqual({
      state: "value",
      value: "Base",
      sourceTemplateFieldNodeId: "base-template",
      candidates: [
        {
          value: "Base",
          sourceTemplateFieldNodeIds: ["base-template", "other-template"],
        },
      ],
    });
    expect(
      nodeText(
        (await projection(workspace, "nodes")).nodes[
          templateFieldInstanceValueNodeId("same-default-instance", "base-template")
        ],
      ),
    ).toBe("Base");
  });

  it("preserves both Extension paths when a diamond contributes the same Template Field", async () => {
    const { workspace } = await open(new InMemoryDocumentStore(), "751");
    expect(
      (
        await mutate(workspace, "diamond-setup", [
          ...setupNodes(),
          nodeAt("diamond-target", "workspace", "supertag-definition"),
          nodeAt("diamond-instance", "workspace"),
        ])
      ).status,
    ).toBe("published");
    expect(
      await mutate(workspace, "diamond-field", [
        templateFieldCreation("task-supertag", "diamond-template", "status-definition"),
      ]),
    ).toMatchObject({ status: "published" });
    expect(
      await mutate(workspace, "diamond-left-node", [
        nodeAt("diamond-left", "workspace", "supertag-definition"),
        extensionAdd("diamond-left", "task-supertag"),
        extensionAdd("other-supertag", "task-supertag"),
        extensionAdd("diamond-target", "diamond-left"),
        extensionAdd("diamond-target", "other-supertag"),
        createSupertagApplication("diamond-instance", "diamond-target"),
      ]),
    ).toMatchObject({ status: "published" });
    expect((await projection(workspace, "effectiveFields")).effectiveFields["diamond-instance"]?.[0]?.sources).toEqual([
      expect.objectContaining({
        templateFieldNodeId: "diamond-template",
        extensionPath: ["diamond-target", "diamond-left", "task-supertag"],
      }),
      expect.objectContaining({
        templateFieldNodeId: "diamond-template",
        extensionPath: ["diamond-target", "other-supertag", "task-supertag"],
      }),
    ]);
  });
});

async function open(documents = new InMemoryDocumentStore(), loroPeerId: `${number}` = "701") {
  const facts = await FactAuthority.open({
    workspaceId: "workspace",
    replicaId: createReplicaId(),
    loroPeerId,
    authorityJournal: documents,
    factReplication: documents,
    admitRecords: admitAuthorityRecords,
  });
  return { facts, workspace: await Workspace.open({ workspaceId: "workspace", facts, versions }) };
}

async function mutate(
  workspace: Workspace,
  invocationId: string,
  mutations: readonly EditMutation[],
  intent: "direct" | "proposal" = "direct",
) {
  return workspace.execute({
    kind: "mutate",
    workspaceId: "workspace",
    invocationId,
    actorId: "actor",
    intent,
    historyChannelId: "template-fields",
    mutations,
  });
}

async function projection<
  Section extends
    | "nodes"
    | "nodeOwners"
    | "occurrences"
    | "templateFields"
    | "optionalFieldContributions"
    | "effectiveFields"
    | "optionalFieldSuggestions"
    | "materializedFields",
>(workspace: Workspace, section: Section, perspective: "origin" | "review" = "origin") {
  const result = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective,
    section,
  });
  if (!(section in result)) {
    throw new Error(`Expected ${section} Projection`);
  }
  return result as Extract<typeof result, Record<Section, unknown>>;
}

function setupNodes(): readonly EditMutation[] {
  return [
    nodeAt("task", "workspace"),
    nodeAt("task-supertag", "workspace", "supertag-definition"),
    nodeAt("other-supertag", "workspace", "supertag-definition"),
  ];
}

function nodeAt(nodeId: string, parentNodeId: string, intrinsicNodeType?: "supertag-definition"): EditMutation {
  return {
    kind: "node-create",
    nodeId,
    occurrenceId: `${nodeId}-original`,
    parentNodeId,
    anchor: end,
    ...(intrinsicNodeType === undefined ? {} : { intrinsicNodeType }),
  };
}

function templateFieldCreation(
  supertagId: string,
  templateFieldNodeId: string,
  fieldDefinitionId: string,
): EditMutation {
  return {
    kind: "supertag-template-field-create",
    supertagId,
    templateFieldNodeId,
    templateFieldOccurrenceId: `${templateFieldNodeId}-occurrence`,
    fieldDefinitionId,
    definitionOccurrenceId: `${templateFieldNodeId}-definition`,
    staticDefaultValueNodeId: "status-default",
    staticDefaultValueOccurrenceId: `${templateFieldNodeId}-default`,
    anchor: end,
    fieldDefinitionSeed: { text: [{ value: "Status", attributes: {} }] },
  };
}

function existingTemplateField(
  supertagId: string,
  templateFieldNodeId: string,
  fieldDefinitionId: string,
): EditMutation {
  return {
    kind: "supertag-template-field-add-existing",
    supertagId,
    templateFieldNodeId,
    templateFieldOccurrenceId: `${templateFieldNodeId}-occurrence`,
    fieldDefinitionId,
    definitionOccurrenceId: `${templateFieldNodeId}-definition`,
    staticDefaultValueNodeId: `${templateFieldNodeId}-default`,
    staticDefaultValueOccurrenceId: `${templateFieldNodeId}-default-occurrence`,
    anchor: end,
  };
}

function optionalField(supertagId: string, fieldDefinitionId: string): EditMutation {
  return {
    kind: "supertag-optional-field-contribution-add",
    supertagId,
    metanodeId: `${supertagId}-metanode`,
    fieldNurseryNodeId: `${supertagId}-fields`,
    fieldNurseryOccurrenceId: `${supertagId}-fields-occurrence`,
    nurseryDefinitionOccurrenceId: `${supertagId}-fields-definition`,
    nurseryValueNodeId: `${supertagId}-fields-value`,
    nurseryValueOccurrenceId: `${supertagId}-fields-value-occurrence`,
    contributionNodeId: "other-status-contribution",
    contributionOccurrenceId: "other-status-contribution-occurrence",
    fieldDefinitionId,
    definitionOccurrenceId: "other-status-definition",
    valueNodeId: "other-status-value",
    valueOccurrenceId: "other-status-value-occurrence",
    anchor: end,
  };
}

function staticDefault(supertagId: string, templateFieldNodeId: string, value: string): EditMutation {
  return { kind: "supertag-template-field-static-default-set", supertagId, templateFieldNodeId, value };
}

function extensionAdd(supertagId: string, baseSupertagId: string): EditMutation {
  return { kind: "supertag-extension-add", supertagId, baseSupertagId, anchor: end };
}

function extensionRemove(supertagId: string, baseSupertagId: string): EditMutation {
  return { kind: "supertag-extension-remove", supertagId, baseSupertagId };
}

function nodeText(node: { content: readonly { kind: string; value?: string }[] } | undefined): string {
  return (
    node?.content.flatMap((item) => (item.kind === "text" && item.value !== undefined ? [item.value] : [])).join("") ??
    ""
  );
}
