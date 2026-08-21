import { describe, expect, it } from "vitest";
import { createSupertagApplication } from "../../../tests/support/workspace/edit-test-mutations.js";

import type { MutationCommand, SearchExpressionSpec, SearchResultsResult } from "@lode/sdk";
import { admitAuthorityRecords } from "../../domain/admission/index.js";
import { FIELD_DATATYPE_NODE_IDS } from "../../domain/fact/index.js";
import { InMemoryDocumentStore } from "../persistence/in-memory-document-store.js";
import { createReplicaId, FactAuthority } from "./authority/fact-authority.js";
import { FactReplication } from "./fact-replication.js";
import { syncPair } from "../../../tests/support/sync.js";
import { Workspace } from "./workspace.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("Search Node product model", () => {
  it("SEARCH-1 evaluates one Supertag Search Expression across Origin, Review, and Trash", async () => {
    const workspace = await setup();
    await createSearchFixture(workspace);
    const proposal = await workspace.execute(
      command(
        "base-expression",
        "search",
        [
          {
            kind: "search-expression-create",
            searchNodeId: "search",
            metanodeId: "search-configuration",
            expressionNodeId: "base-expression",
            expressionOccurrenceId: "base-expression-occurrence",
            definitionOccurrenceId: "base-expression-definition",
            expression: { expressionNodeId: "base-expression", kind: "supertag", supertagId: "base-supertag" },
            anchor: end,
          },
        ],
        "proposal",
      ),
    );
    expect(proposal.status).toBe("published");
    expect(await resultNodeIds(workspace, "origin")).toEqual([]);
    expect(await resultNodeIds(workspace, "review")).toEqual(["base-candidate", "subtype-candidate"]);

    const review = await workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in review) || !review.hunks[0]) {
      throw new Error("Expected Search Expression Review Hunk");
    }
    const acceptedExpression = await workspace.execute({
      kind: "resolve-review",
      workspaceId: "workspace",
      invocationId: "accept-search-expression",
      actorId: "reviewer",
      decision: "accept",
      selection: review.hunks[0].selection,
    });
    expect(acceptedExpression, JSON.stringify(acceptedExpression)).toMatchObject({ status: "published" });
    expect(await resultNodeIds(workspace, "origin")).toEqual(["base-candidate", "subtype-candidate"]);
    const supertagPage = await workspace.query({
      kind: "supertag-instances",
      workspaceId: "workspace",
      perspective: "origin",
      supertagId: "base-supertag",
    });
    expect("nodeIds" in supertagPage ? supertagPage.nodeIds : []).toEqual(await resultNodeIds(workspace, "origin"));

    const duplicate = await workspace.execute(
      command("duplicate-expression", "search", [
        {
          kind: "search-expression-create",
          searchNodeId: "search",
          metanodeId: "search-configuration",
          expressionNodeId: "duplicate-expression",
          expressionOccurrenceId: "duplicate-expression-occurrence",
          definitionOccurrenceId: "duplicate-expression-definition",
          expression: {
            expressionNodeId: "duplicate-expression",
            kind: "supertag",
            supertagId: "subtype-supertag",
          },
          anchor: end,
        },
      ]),
    );
    expect(duplicate).toMatchObject({ status: "rejected" });

    const candidateDeletion = await workspace.execute(
      command("trash-candidate", "candidate", [{ kind: "node-delete", nodeId: "subtype-candidate" }]),
    );
    if (candidateDeletion.status !== "published") {
      throw new Error("Expected Search candidate deletion");
    }
    expect(await resultNodeIds(workspace, "origin")).toEqual(["base-candidate"]);
    await workspace.execute(
      command("restore-candidate", "candidate", [
        {
          kind: "node-restore",
          nodeId: "subtype-candidate",
          deletionFactId: required(candidateDeletion.receipt.factIds[0], "candidate deletion Fact"),
          occurrenceId: "subtype-candidate-original",
          ownerNodeId: "workspace",
          parentNodeId: "workspace",
          anchor: end,
        },
      ]),
    );
    expect(await resultNodeIds(workspace, "origin")).toEqual(["base-candidate", "subtype-candidate"]);

    const searchDeletion = await workspace.execute(
      command("trash-search", "search-node", [{ kind: "node-delete", nodeId: "search" }]),
    );
    if (searchDeletion.status !== "published") {
      throw new Error("Expected Search Node deletion");
    }
    const unavailable = await searchResults(workspace, "origin");
    expect(unavailable.available).toBe(false);
    expect(unavailable.results).toEqual([]);
    await workspace.execute(
      command("restore-search", "search-node", [
        {
          kind: "node-restore",
          nodeId: "search",
          deletionFactId: required(searchDeletion.receipt.factIds[0], "Search deletion Fact"),
          occurrenceId: "search-original",
          ownerNodeId: "workspace",
          parentNodeId: "workspace",
          anchor: end,
        },
      ]),
    );
    expect(await resultNodeIds(workspace, "origin")).toEqual(["base-candidate", "subtype-candidate"]);
  });

  it("SEARCH-2 keeps expression identity and hidden ownership through public Undo and Redo", async () => {
    const workspace = await setup();
    await createSearchFixture(workspace);
    const created = await workspace.execute(
      command("create-expression", "search-history", [
        {
          kind: "search-expression-create",
          searchNodeId: "search",
          metanodeId: "search-configuration",
          expressionNodeId: "base-expression",
          expressionOccurrenceId: "base-expression-occurrence",
          definitionOccurrenceId: "base-expression-definition",
          expression: { expressionNodeId: "base-expression", kind: "supertag", supertagId: "base-supertag" },
          anchor: end,
        },
      ]),
    );
    expect(created.status).toBe("published");
    const projected = await searchProjection(workspace);
    expect(projected.metanodes).toMatchObject({ search: "search-configuration" });
    expect(projected.nodeOwners["base-expression"]).toBe("search-configuration");
    expect(projected.searchExpressions.search).toEqual({
      expressionNodeId: "base-expression",
      expressionOccurrenceId: "base-expression-occurrence",
      definitionOccurrenceId: "base-expression-definition",
      expression: { expressionNodeId: "base-expression", kind: "supertag", supertagId: "base-supertag" },
    });
    expect(
      Object.values(projected.occurrences).some((occurrence) => occurrence.nodeId === "search-configuration"),
    ).toBe(false);

    const history = await workspace.query({ kind: "history", workspaceId: "workspace", channelId: "search-history" });
    if (!("undo" in history) || !history.undo) {
      throw new Error("Expected Search expression Undo");
    }
    const undoResult = await workspace.execute({
      kind: "undo",
      workspaceId: "workspace",
      invocationId: "undo-search-expression",
      actorId: "actor",
      selection: history.undo,
    });
    if (undoResult.status === "rejected") {
      throw new Error(JSON.stringify(undoResult.error));
    }
    expect(undoResult.status).toBe("published");
    expect(await resultNodeIds(workspace, "origin")).toEqual([]);

    const corruption = await workspace.execute(
      command("corrupt-removed-search-expression", "search-history", [
        {
          kind: "occurrence-create",
          occurrenceId: "rogue-search-endpoint",
          nodeId: "base-supertag",
          parentNodeId: "base-expression",
          anchor: end,
        },
      ]),
    );
    expect(corruption).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });

    const redo = await workspace.query({ kind: "history", workspaceId: "workspace", channelId: "search-history" });
    if (!("redo" in redo) || !redo.redo) {
      throw new Error("Expected Search expression Redo");
    }
    expect(
      (
        await workspace.execute({
          kind: "redo",
          workspaceId: "workspace",
          invocationId: "redo-search-expression",
          actorId: "actor",
          selection: redo.redo,
        })
      ).status,
    ).toBe("published");
    expect((await searchProjection(workspace)).searchExpressions.search?.expressionNodeId).toBe("base-expression");
    expect(await resultNodeIds(workspace, "origin")).toEqual(["base-candidate", "subtype-candidate"]);
  });

  it("SEARCH-3 composes daily clauses, preserves clause identities through updates, and evaluates live Originals", async () => {
    const workspace = await setup();
    await createComposedSearchFixture(workspace);
    const expression = composedExpression(true);
    expect(
      (
        await workspace.execute(
          command("create-composed-expression", "composed-search", [
            {
              kind: "search-expression-create",
              searchNodeId: "search",
              metanodeId: "search-configuration",
              expressionNodeId: "composed-expression",
              expressionOccurrenceId: "composed-expression-occurrence",
              definitionOccurrenceId: "composed-expression-definition",
              expression,
              anchor: end,
            },
          ]),
        )
      ).status,
    ).toBe("published");
    expect(await resultNodeIds(workspace, "origin")).toEqual(["matching-candidate"]);

    const reorderedOperands = [6, 5, 2, 0, 4, 1, 3].map((index) => expression.operands[index]);
    if (reorderedOperands.some((operand) => operand === undefined)) {
      throw new Error("Expected every composed Search operand");
    }
    const definedOperands = reorderedOperands.filter(
      (operand): operand is NonNullable<typeof operand> => operand !== undefined,
    );
    const reordered: SearchExpressionSpec = {
      ...expression,
      operands: definedOperands,
    };
    expect(
      (
        await workspace.execute(
          command("reorder-composed-expression", "composed-search", [
            { kind: "search-expression-update", searchNodeId: "search", expression: reordered },
          ]),
        )
      ).status,
    ).toBe("published");
    const afterReorder = (await searchProjection(workspace)).searchExpressions.search;
    expect(afterReorder).toMatchObject({
      expressionNodeId: "composed-expression",
      expressionOccurrenceId: "composed-expression-occurrence",
      definitionOccurrenceId: "composed-expression-definition",
      expression: { expressionNodeId: "composed-expression", kind: "and" },
    });
    expect(
      afterReorder?.expression.kind === "and"
        ? afterReorder.expression.operands.map((item) => item.expressionNodeId)
        : [],
    ).toEqual([
      "field-value-clause",
      "links-clause",
      "not-clause",
      "tag-clause",
      "scope-clause",
      "or-clause",
      "date-clause",
    ]);
    const reorderHistory = await workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "composed-search",
    });
    if (!("undo" in reorderHistory) || reorderHistory.undo === null) {
      throw new Error("Expected Search Expression update Undo");
    }
    expect(
      (
        await workspace.execute({
          kind: "undo",
          workspaceId: "workspace",
          invocationId: "undo-search-reorder",
          actorId: "actor",
          selection: reorderHistory.undo,
        })
      ).status,
    ).toBe("published");
    expect((await searchProjection(workspace)).searchExpressions.search?.expression).toEqual(expression);
    const redoReorder = await workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "composed-search",
    });
    if (!("redo" in redoReorder) || redoReorder.redo === null) {
      throw new Error("Expected Search Expression update Redo");
    }
    expect(
      (
        await workspace.execute({
          kind: "redo",
          workspaceId: "workspace",
          invocationId: "redo-search-reorder",
          actorId: "actor",
          selection: redoReorder.redo,
        })
      ).status,
    ).toBe("published");
    expect((await searchProjection(workspace)).searchExpressions.search?.expression).toEqual(reordered);

    const withoutDefined = composedExpression(false);
    await expectPublished(
      workspace,
      command("remove-defined-clause", "composed-search", [
        { kind: "search-expression-update", searchNodeId: "search", expression: withoutDefined },
      ]),
    );
    expect(searchExpressionIds((await searchProjection(workspace)).searchExpressions.search?.expression)).not.toContain(
      "defined-clause",
    );
    await expectPublished(
      workspace,
      command("readd-defined-clause", "composed-search", [
        { kind: "search-expression-update", searchNodeId: "search", expression: composedExpression(true) },
      ]),
    );
    expect(searchExpressionIds((await searchProjection(workspace)).searchExpressions.search?.expression)).toContain(
      "defined-clause",
    );

    const explicitScope = composedExpression(true);
    const relativeScope: SearchExpressionSpec = {
      ...explicitScope,
      operands: explicitScope.operands.map((operand) =>
        operand.expressionNodeId === "scope-clause"
          ? {
              expressionNodeId: "scope-clause",
              kind: "descendant-of" as const,
              target: { kind: "parent" as const },
            }
          : operand,
      ),
    };
    await expectPublished(
      workspace,
      command("use-relative-parent-scope", "composed-search", [
        { kind: "search-expression-update", searchNodeId: "search", expression: relativeScope },
      ]),
    );
    expect(await resultNodeIds(workspace, "origin")).toEqual(["matching-candidate"]);

    await setText(workspace, "matching-candidate", "Urgent archived item", "archive-original");
    expect(await resultNodeIds(workspace, "origin")).toEqual([]);
    await setText(workspace, "matching-candidate", "Urgent current item", "restore-original");
    expect(await resultNodeIds(workspace, "origin")).toEqual(["matching-candidate"]);
    expect((await searchProjection(workspace)).nodeOwners["composed-expression"]).toBe("search-configuration");
  });

  it("SEARCH-4 restores the composed authority and derived results after restart", async () => {
    const documents = new InMemoryDocumentStore();
    const first = await setup(documents, "211");
    await createComposedSearchFixture(first);
    await expectPublished(
      first,
      command("persistent-search", "persistent-search", [
        {
          kind: "search-expression-create",
          searchNodeId: "search",
          metanodeId: "search-configuration",
          expressionNodeId: "composed-expression",
          expressionOccurrenceId: "composed-expression-occurrence",
          definitionOccurrenceId: "composed-expression-definition",
          expression: composedExpression(true),
          anchor: end,
        },
      ]),
    );
    const restarted = await setup(documents, "212");
    expect(await resultNodeIds(restarted, "origin")).toEqual(["matching-candidate"]);
    expect((await searchProjection(restarted)).searchExpressions.search?.expression).toEqual(composedExpression(true));
  });

  it("SEARCH-5 syncs legal composed authority and rejects target-ownership smuggling", async () => {
    const left = await openSearchWorkspace(new InMemoryDocumentStore(), "221");
    const right = await openSearchWorkspace(new InMemoryDocumentStore(), "222");
    await createComposedSearchFixture(left.workspace);
    await expectPublished(
      left.workspace,
      command("sync-composed-search", "sync-search", [
        {
          kind: "search-expression-create",
          searchNodeId: "search",
          metanodeId: "search-configuration",
          expressionNodeId: "composed-expression",
          expressionOccurrenceId: "composed-expression-occurrence",
          definitionOccurrenceId: "composed-expression-definition",
          expression: composedExpression(true),
          anchor: end,
        },
      ]),
    );
    await syncPair(new FactReplication(left.facts.replication), new FactReplication(right.facts.replication));
    await right.workspace.reconcileAuthorityAdvance();
    expect(await resultNodeIds(right.workspace, "origin")).toEqual(["matching-candidate"]);

    const projected = (await searchProjection(left.workspace)).searchExpressions.search;
    if (projected === undefined) {
      throw new Error("Expected synced Search Expression");
    }
    expect((await searchProjection(left.workspace)).nodeOwners["linked-target"]).toBe("workspace");
    await expect(
      left.facts.commit({
        invocationId: "smuggle-search-target-owner",
        request: { command: "smuggle-search-target-owner" },
        writes: [
          {
            kind: "transaction",
            bodies: [
              {
                kind: "contribution",
                actorId: "attacker",
                intent: "direct",
                mutation: {
                  kind: "search-expression-attach",
                  searchNodeId: "search",
                  expressionNodeId: projected.expressionNodeId,
                  expressionOccurrenceId: projected.expressionOccurrenceId,
                  definitionOccurrenceId: projected.definitionOccurrenceId,
                  expression: projected.expression,
                  previousExpression: projected.expression,
                },
              },
              {
                kind: "contribution",
                actorId: "attacker",
                intent: "direct",
                mutation: {
                  kind: "node-owner-set",
                  nodeId: "composed-expression",
                  ownerNodeId: "workspace",
                  previousOwnerNodeId: "search-configuration",
                },
              },
            ],
          },
        ],
        lineage: null,
        publishedFrontier: left.facts.snapshot().frontier,
      }),
    ).rejects.toThrow(/Structural role|structure|Owner/i);
  });

  it("SEARCH-6 distinguishes Effective placeholders from Materialized Fields for Defined and Not Defined", async () => {
    const workspace = await setup();
    await expectPublished(
      workspace,
      command("defined-search-nodes", "defined-search", [
        nodeAt("field-supertag", "workspace", "field-supertag-original", "supertag-definition"),
        nodeAt("search", "workspace", "search-original", "search"),
        nodeAt("effective-candidate", "workspace", "effective-candidate-original"),
        nodeAt("materialized-candidate", "workspace", "materialized-candidate-original"),
      ]),
    );
    await expectPublished(
      workspace,
      command("defined-search-template", "defined-search", [
        {
          kind: "supertag-template-field-create",
          supertagId: "field-supertag",
          templateFieldNodeId: "status-template",
          templateFieldOccurrenceId: "status-template-occurrence",
          fieldDefinitionId: "status-definition",
          definitionOccurrenceId: "status-template-definition",
          staticDefaultValueNodeId: "status-default",
          staticDefaultValueOccurrenceId: "status-template-default",
          anchor: end,
          fieldDefinitionSeed: { text: [{ value: "Status", attributes: {} }] },
        },
      ]),
    );
    await expectPublished(
      workspace,
      command("defined-search-applications", "defined-search", [
        createSupertagApplication("effective-candidate", "field-supertag"),
        createSupertagApplication("materialized-candidate", "field-supertag"),
      ]),
    );
    await expectPublished(
      workspace,
      command("author-materialized-field", "defined-search", [
        nodeAt("materialized-status-field", "materialized-candidate", "materialized-status-field-occurrence"),
        nodeAt("materialized-status-value", "materialized-status-field", "materialized-status-value-occurrence"),
        {
          kind: "text-splice",
          nodeId: "materialized-status-value",
          deleteAtomIds: [],
          anchor: end,
          insert: "Authored",
        },
        {
          kind: "field-materialize",
          ownerNodeId: "materialized-candidate",
          fieldDefinitionId: "status-definition",
          fieldNodeId: "materialized-status-field",
          fieldOccurrenceId: "materialized-status-field-occurrence",
        },
      ]),
    );

    const effectiveFields = await workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "effectiveFields",
    });
    const materializedFields = await workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "materializedFields",
    });
    if (!("effectiveFields" in effectiveFields) || !("materializedFields" in materializedFields)) {
      throw new Error("Expected Effective and Materialized Field Projections");
    }
    expect(effectiveFields.effectiveFields["effective-candidate"]?.[0]).toMatchObject({
      fieldDefinitionId: "status-definition",
      materializedFieldNodeId: null,
    });
    expect(materializedFields.materializedFields["effective-candidate"]).toBeUndefined();
    expect(materializedFields.materializedFields["materialized-candidate"]?.[0]).toMatchObject({
      fieldDefinitionId: "status-definition",
      fieldNodeId: "materialized-status-field",
    });

    const definedExpression: SearchExpressionSpec = {
      expressionNodeId: "defined-search-expression",
      kind: "and",
      operands: [
        { expressionNodeId: "tag-clause", kind: "supertag", supertagId: "field-supertag" },
        {
          expressionNodeId: "defined-clause",
          kind: "field-defined",
          fieldDefinitionId: "status-definition",
          defined: true,
        },
      ],
    };
    await expectPublished(
      workspace,
      command("create-defined-search", "defined-search", [
        {
          kind: "search-expression-create",
          searchNodeId: "search",
          metanodeId: "search-configuration",
          expressionNodeId: "defined-search-expression",
          expressionOccurrenceId: "defined-search-expression-occurrence",
          definitionOccurrenceId: "defined-search-expression-definition",
          expression: definedExpression,
          anchor: end,
        },
      ]),
    );
    expect(await resultNodeIds(workspace, "origin")).toEqual(["materialized-candidate"]);

    const notDefinedExpression: SearchExpressionSpec = {
      ...definedExpression,
      operands: definedExpression.operands.map((operand) =>
        operand.expressionNodeId === "defined-clause" && operand.kind === "field-defined"
          ? { ...operand, defined: false }
          : operand,
      ),
    };
    await expectPublished(
      workspace,
      command("use-not-defined-search", "defined-search", [
        { kind: "search-expression-update", searchNodeId: "search", expression: notDefinedExpression },
      ]),
    );
    expect((await searchProjection(workspace)).searchExpressions.search).toMatchObject({
      expressionNodeId: "defined-search-expression",
      expression: {
        expressionNodeId: "defined-search-expression",
        operands: [{ expressionNodeId: "tag-clause" }, { expressionNodeId: "defined-clause", defined: false }],
      },
    });
    expect(await resultNodeIds(workspace, "origin")).toEqual(["effective-candidate"]);
  });
});

async function setup(
  documents: InMemoryDocumentStore = new InMemoryDocumentStore(),
  loroPeerId: `${number}` = "201",
): Promise<Workspace> {
  return (await openSearchWorkspace(documents, loroPeerId)).workspace;
}

async function openSearchWorkspace(documents: InMemoryDocumentStore, loroPeerId: `${number}`) {
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

async function createSearchFixture(workspace: Workspace): Promise<void> {
  const operations: MutationCommand["mutations"] = [
    nodeAt("base-supertag", "workspace", "base-supertag-original", "supertag-definition"),
    nodeAt("subtype-supertag", "workspace", "subtype-supertag-original", "supertag-definition"),
    nodeAt("search", "workspace", "search-original", "search"),
    nodeAt("base-candidate", "workspace", "base-candidate-original"),
    nodeAt("subtype-candidate", "workspace", "subtype-candidate-original"),
    {
      kind: "supertag-extension-add",
      supertagId: "subtype-supertag",
      baseSupertagId: "base-supertag",
      anchor: end,
    },
    createSupertagApplication("base-candidate", "base-supertag"),
    createSupertagApplication("subtype-candidate", "subtype-supertag"),
  ];
  const result = await workspace.execute(command("fixture", "setup", operations));
  if (result.status === "rejected") {
    throw new Error(JSON.stringify(result.error));
  }
  expect(result.status).toBe("published");
}

async function createComposedSearchFixture(workspace: Workspace): Promise<void> {
  await expectPublished(
    workspace,
    command("composed-fixture-nodes", "setup", [
      nodeAt("base-supertag", "workspace", "base-supertag-original", "supertag-definition"),
      nodeAt("date-field", "workspace", "date-field-original", "field-definition"),
      nodeAt("project", "workspace", "project-original"),
      nodeAt("search", "project", "search-original", "search"),
      nodeAt("linked-target", "workspace", "linked-target-original"),
      nodeAt("matching-candidate", "project", "matching-candidate-original"),
      nodeAt("missing-link-candidate", "project", "missing-link-candidate-original"),
      {
        kind: "text-splice",
        nodeId: "matching-candidate",
        deleteAtomIds: [],
        anchor: end,
        insert: "Urgent current item",
      },
      {
        kind: "text-splice",
        nodeId: "missing-link-candidate",
        deleteAtomIds: [],
        anchor: end,
        insert: "Urgent current item",
      },
      createSupertagApplication("matching-candidate", "base-supertag"),
      createSupertagApplication("missing-link-candidate", "base-supertag"),
    ]),
  );
  await expectPublished(
    workspace,
    command("configure-search-date", "setup", [
      {
        kind: "field-datatype-configuration-create",
        fieldDefinitionId: "date-field",
        configurationNodeId: "date-datatype-configuration",
        configurationOccurrenceId: "date-datatype-configuration-occurrence",
        definitionOccurrenceId: "date-datatype-definition-occurrence",
        valueOccurrenceId: "date-datatype-value-occurrence",
        datatypeNodeId: FIELD_DATATYPE_NODE_IDS.date,
        anchor: end,
      },
    ]),
  );
  await expectPublished(
    workspace,
    command("set-search-dates", "setup", [
      dateValue("matching-candidate", "matching", "2026-08-20"),
      dateValue("missing-link-candidate", "missing-link", "2026-08-20"),
      {
        kind: "inline-reference-create",
        inlineReferenceId: "matching-link",
        hostNodeId: "matching-candidate",
        targetNodeId: "linked-target",
        anchor: end,
      },
    ]),
  );
}

function dateValue(ownerNodeId: string, prefix: string, value: string): MutationCommand["mutations"][number] {
  return {
    kind: "field-date-value-set",
    ownerNodeId,
    fieldDefinitionId: "date-field",
    fieldNodeId: `${prefix}-date-field-node`,
    fieldOccurrenceId: `${prefix}-date-field-occurrence`,
    valueNodeId: `${prefix}-date-value`,
    valueOccurrenceId: `${prefix}-date-value-occurrence`,
    value,
  };
}

function composedExpression(includeDefined: boolean) {
  const orOperands = [
    { expressionNodeId: "text-clause", kind: "text" as const, text: "urgent" },
    ...(includeDefined
      ? [
          {
            expressionNodeId: "defined-clause",
            kind: "field-defined" as const,
            fieldDefinitionId: "date-field",
            defined: true,
          },
        ]
      : []),
  ];
  return {
    expressionNodeId: "composed-expression",
    kind: "and" as const,
    operands: [
      { expressionNodeId: "tag-clause", kind: "supertag" as const, supertagId: "base-supertag" },
      { expressionNodeId: "or-clause", kind: "or" as const, operands: orOperands },
      {
        expressionNodeId: "not-clause",
        kind: "not" as const,
        operand: { expressionNodeId: "archived-clause", kind: "text" as const, text: "archived" },
      },
      {
        expressionNodeId: "date-clause",
        kind: "date-compare" as const,
        fieldDefinitionId: "date-field",
        operator: "lt" as const,
        date: "2026-09-01",
      },
      {
        expressionNodeId: "scope-clause",
        kind: "descendant-of" as const,
        target: { kind: "node" as const, nodeId: "project" },
      },
      { expressionNodeId: "links-clause", kind: "links-to" as const, targetNodeId: "linked-target" },
      {
        expressionNodeId: "field-value-clause",
        kind: "field-value" as const,
        fieldDefinitionId: "date-field",
        value: { kind: "date" as const, value: "2026-08-20" },
      },
    ],
  };
}

function nodeAt(
  nodeId: string,
  parentNodeId: string,
  occurrenceId: string,
  intrinsicNodeType?: "supertag-definition" | "field-definition" | "search",
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

function command(
  invocationId: string,
  historyChannelId: string,
  mutations: MutationCommand["mutations"],
  intent: MutationCommand["intent"] = "direct",
): MutationCommand {
  return {
    kind: "mutate",
    workspaceId: "workspace",
    invocationId,
    actorId: "actor",
    intent,
    historyChannelId,
    mutations,
  };
}

async function searchResults(workspace: Workspace, perspective: "origin" | "review"): Promise<SearchResultsResult> {
  return workspace.query({
    kind: "search-results",
    workspaceId: "workspace",
    perspective,
    searchNodeId: "search",
  });
}

async function resultNodeIds(workspace: Workspace, perspective: "origin" | "review"): Promise<readonly string[]> {
  return (await searchResults(workspace, perspective)).results.map((result) => result.targetNodeId);
}

async function searchProjection(workspace: Workspace) {
  const [roots, owners, expressions, occurrences] = await Promise.all([
    workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "metanodes",
    }),
    workspace.query({ kind: "projection", workspaceId: "workspace", perspective: "origin", section: "nodeOwners" }),
    workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "searchExpressions",
    }),
    workspace.query({ kind: "projection", workspaceId: "workspace", perspective: "origin", section: "occurrences" }),
  ]);
  if (
    !("metanodes" in roots) ||
    !("nodeOwners" in owners) ||
    !("searchExpressions" in expressions) ||
    !("occurrences" in occurrences)
  ) {
    throw new Error("Expected Search Projection sections");
  }
  return {
    metanodes: roots.metanodes,
    nodeOwners: owners.nodeOwners,
    searchExpressions: expressions.searchExpressions,
    occurrences: occurrences.occurrences,
  };
}

async function setText(workspace: Workspace, nodeId: string, value: string, invocationId: string): Promise<void> {
  const nodes = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective: "origin",
    section: "nodes",
  });
  if (!("nodes" in nodes)) {
    throw new Error("Expected Nodes Projection");
  }
  const deleteAtomIds = (nodes.nodes[nodeId]?.content ?? [])
    .filter((item) => item.kind === "text")
    .map((item) => item.id);
  await expectPublished(
    workspace,
    command(invocationId, "candidate-text", [
      { kind: "text-splice", nodeId, deleteAtomIds, anchor: end, insert: value },
    ]),
  );
}

function searchExpressionIds(expression: SearchExpressionSpec | undefined): readonly string[] {
  if (expression === undefined) {
    return [];
  }
  if (expression.kind === "and" || expression.kind === "or") {
    return [expression.expressionNodeId, ...expression.operands.flatMap(searchExpressionIds)];
  }
  if (expression.kind === "not") {
    return [expression.expressionNodeId, ...searchExpressionIds(expression.operand)];
  }
  return [expression.expressionNodeId];
}

async function expectPublished(workspace: Workspace, mutationCommand: MutationCommand): Promise<void> {
  const result = await workspace.execute(mutationCommand);
  if (result.status === "rejected") {
    throw new Error(JSON.stringify(result.error));
  }
  expect(result.status).toBe("published");
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}
