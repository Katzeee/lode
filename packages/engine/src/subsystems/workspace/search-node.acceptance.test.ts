import { describe, expect, it } from "vitest";

import type { EditCommand, SearchExpressionSpec, SearchResultsResult } from "@lode/sdk";
import { createSupertagApplication } from "../../../tests/support/workspace/edit-test-actions.js";
import { syncPair } from "../../../tests/support/sync.js";
import { FIELD_DATATYPE_NODE_IDS, materializedFieldNodeId } from "../../domain/fact/index.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import { InMemoryDocumentStore } from "../persistence/in-memory-document-store.js";
import { FactAuthority } from "./authority/fact-authority.js";
import { FactReplication } from "./fact-replication.js";
import { Workspace } from "./workspace.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("Search Node product model", () => {
  it("SEARCH-1 evaluates a Supertag expression across Origin, Review, and Trash", async () => {
    const workspace = await setup();
    await createSearchFixture(workspace);
    await expectPublished(
      workspace,
      command(
        "base-expression",
        "search",
        [
          {
            kind: "search-expression-create",
            searchNodeId: "search",
            expression: { kind: "supertag", supertagId: "base-supertag" },
            anchor: end,
          },
        ],
        "proposal",
      ),
    );
    expect(await resultNodeIds(workspace, "origin")).toEqual([]);
    expect(await resultNodeIds(workspace, "review")).toEqual(["base-candidate", "subtype-candidate"]);
    await acceptAllHunks(workspace, "accept-search-expression");
    expect(await resultNodeIds(workspace, "origin")).toEqual(["base-candidate", "subtype-candidate"]);

    const expression = required((await searchProjection(workspace)).searchExpressions.search, "Search Expression");
    expect(expression.expression.expressionNodeId).toBe(expression.expressionNodeId);
    expect(expression.expression.expressionId).toContain("/actions/");

    const duplicate = await workspace.execute(
      command("duplicate-expression", "search", [
        {
          kind: "search-expression-create",
          searchNodeId: "search",
          expression: { kind: "supertag", supertagId: "subtype-supertag" },
          anchor: end,
        },
      ]),
    );
    expect(duplicate).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });

    await expectPublished(
      workspace,
      command("trash-candidate", "candidate", [{ kind: "node-delete", nodeId: "subtype-candidate" }]),
    );
    expect(await resultNodeIds(workspace, "origin")).toEqual(["base-candidate"]);
    await expectPublished(
      workspace,
      command("restore-candidate", "candidate", [
        {
          kind: "node-restore",
          nodeId: "subtype-candidate",
          occurrenceId: "subtype-candidate-original",
          parentNodeId: "workspace",
          anchor: end,
        },
      ]),
    );
    expect(await resultNodeIds(workspace, "origin")).toEqual(["base-candidate", "subtype-candidate"]);

    await expectPublished(
      workspace,
      command("trash-search", "search-node", [{ kind: "node-delete", nodeId: "search" }]),
    );
    expect(await searchResults(workspace, "origin")).toMatchObject({ available: false, results: [] });
    await expectPublished(
      workspace,
      command("restore-search", "search-node", [
        {
          kind: "node-restore",
          nodeId: "search",
          occurrenceId: "search-original",
          parentNodeId: "workspace",
          anchor: end,
        },
      ]),
    );
    expect(await resultNodeIds(workspace, "origin")).toEqual(["base-candidate", "subtype-candidate"]);
  });

  it("SEARCH-2 keeps generated expression identities stable through granular edits and History", async () => {
    const workspace = await setup();
    await createSearchFixture(workspace);
    await expectPublished(
      workspace,
      command("create-expression", "search-history", [
        {
          kind: "search-expression-create",
          searchNodeId: "search",
          expression: {
            kind: "and",
            operands: [
              { kind: "supertag", supertagId: "base-supertag" },
              { kind: "text", text: "candidate" },
            ],
          },
          anchor: end,
        },
      ]),
    );

    const initial = required((await searchProjection(workspace)).searchExpressions.search, "Search Expression");
    if (initial.expression.kind !== "and") {
      throw new Error("Expected conjunction");
    }
    const rootId = initial.expression.expressionId;
    const rootNodeId = initial.expression.expressionNodeId;
    const tagId = required(
      initial.expression.operands.find((item) => item.kind === "supertag"),
      "Supertag clause",
    ).expressionId;
    const textId = required(
      initial.expression.operands.find((item) => item.kind === "text"),
      "Text clause",
    ).expressionId;
    expect((await searchProjection(workspace)).nodeOwners[rootNodeId]).toBe("metanode:v1:search");

    await expectPublished(
      workspace,
      command("add-logical-branch", "search-history", [
        {
          kind: "search-expression-add",
          searchNodeId: "search",
          parentExpressionId: rootId,
          expression: {
            kind: "or",
            operands: [
              { kind: "text", text: "candidate" },
              { kind: "supertag", supertagId: "subtype-supertag" },
            ],
          },
          anchor: end,
        },
      ]),
    );
    const withBranch = required(
      (await searchProjection(workspace)).searchExpressions.search,
      "branched Search Expression",
    );
    if (withBranch.expression.kind !== "and") {
      throw new Error("Expected conjunction");
    }
    const branch = required(
      withBranch.expression.operands.find((item) => item.kind === "or"),
      "logical branch",
    );
    if (branch.kind !== "or") {
      throw new Error("Expected disjunction");
    }
    const branchTextId = required(
      branch.operands.find((item) => item.kind === "text"),
      "branch Text clause",
    ).expressionId;
    await expectPublished(
      workspace,
      command("configure-logical-branch", "search-history", [
        {
          kind: "search-expression-configure",
          searchNodeId: "search",
          expressionId: branchTextId,
          clause: { kind: "text", text: "base" },
        },
      ]),
    );

    await expectPublished(
      workspace,
      command("configure-text", "search-history", [
        {
          kind: "search-expression-configure",
          searchNodeId: "search",
          expressionId: textId,
          clause: { kind: "text", text: "base" },
        },
      ]),
    );
    await expectPublished(
      workspace,
      command("move-text", "search-history", [
        {
          kind: "search-expression-move",
          searchNodeId: "search",
          expressionId: textId,
          parentExpressionId: rootId,
          anchor: { after: null, before: tagId, affinity: "before", fallback: "start" },
        },
      ]),
    );
    const moved = required((await searchProjection(workspace)).searchExpressions.search, "moved Search Expression");
    expect(moved.expression.kind === "and" ? moved.expression.operands.map((item) => item.expressionId) : []).toEqual([
      textId,
      tagId,
      branch.expressionId,
    ]);

    await expectPublished(
      workspace,
      command("remove-text", "search-history", [
        { kind: "search-expression-remove", searchNodeId: "search", expressionId: textId },
      ]),
    );
    expect(searchExpressionIds((await searchProjection(workspace)).searchExpressions.search?.expression)).not.toContain(
      textId,
    );

    await expectPublished(workspace, {
      kind: "undo",
      workspaceId: "workspace",
      invocationId: "undo-search-remove",
      actorId: "actor",
      selection: await historySelection(workspace, "search-history", "undo"),
    });
    const restored = required(
      (await searchProjection(workspace)).searchExpressions.search,
      "restored Search Expression",
    );
    expect(searchExpressionIds(restored.expression)).toContain(textId);
    expect(restored.expression.expressionId).toBe(rootId);

    await expectPublished(workspace, {
      kind: "redo",
      workspaceId: "workspace",
      invocationId: "redo-search-remove",
      actorId: "actor",
      selection: await historySelection(workspace, "search-history", "redo"),
    });
    expect(searchExpressionIds((await searchProjection(workspace)).searchExpressions.search?.expression)).not.toContain(
      textId,
    );
  });

  it("SEARCH-3 evaluates the complete clause algebra and restores the same projection after restart and sync", async () => {
    const documents = new InMemoryDocumentStore();
    const left = await openSearchWorkspace(documents, "211");
    const first = left.workspace;
    await createComposedSearchFixture(first);
    await expectPublished(
      first,
      command("persistent-search", "persistent-search", [
        { kind: "search-expression-create", searchNodeId: "search", expression: composedExpression(), anchor: end },
      ]),
    );
    expect(await resultNodeIds(first, "origin")).toEqual(["matching-candidate"]);

    const before = required((await searchProjection(first)).searchExpressions.search, "composed Search Expression");
    await setText(first, "matching-candidate", "Urgent archived item", "archive-original");
    expect(await resultNodeIds(first, "origin")).toEqual([]);
    await setText(first, "matching-candidate", "Urgent current item", "restore-original");
    expect(await resultNodeIds(first, "origin")).toEqual(["matching-candidate"]);

    const restarted = await setup(documents, "212");
    expect(await resultNodeIds(restarted, "origin")).toEqual(["matching-candidate"]);
    expect((await searchProjection(restarted)).searchExpressions.search).toEqual(before);

    const right = await openSearchWorkspace(new InMemoryDocumentStore(), "222");
    await syncPair(new FactReplication(left.facts.replication), new FactReplication(right.facts.replication));
    await right.workspace.reconcileAuthorityAdvance();
    expect(await resultNodeIds(right.workspace, "origin")).toEqual(["matching-candidate"]);
    expect((await searchProjection(right.workspace)).searchExpressions.search).toEqual(before);
  });

  it("SEARCH-4 distinguishes Effective placeholders from Materialized Fields for Defined and Not Defined", async () => {
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
          fieldDefinitionId: "status-definition",
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
    const materializedFieldNode = materializedFieldNodeId("materialized-candidate", "status-definition");
    await expectPublished(
      workspace,
      command("author-materialized-field", "defined-search", [
        {
          kind: "field-materialize",
          ownerNodeId: "materialized-candidate",
          fieldDefinitionId: "status-definition",
        },
        nodeAt("materialized-status-value", materializedFieldNode, "materialized-status-value-occurrence"),
        {
          kind: "rich-text-splice",
          nodeId: "materialized-status-value",
          deleteAtomIds: [],
          anchor: end,
          insert: "Authored",
        },
      ]),
    );
    await expectPublished(
      workspace,
      command("create-defined-search", "defined-search", [
        {
          kind: "search-expression-create",
          searchNodeId: "search",
          expression: {
            kind: "and",
            operands: [
              { kind: "supertag", supertagId: "field-supertag" },
              { kind: "field-defined", fieldDefinitionId: "status-definition", defined: true },
            ],
          },
          anchor: end,
        },
      ]),
    );
    expect(await resultNodeIds(workspace, "origin")).toEqual(["materialized-candidate"]);

    const expression = required(
      (await searchProjection(workspace)).searchExpressions.search?.expression,
      "defined Search",
    );
    if (expression.kind !== "and") {
      throw new Error("Expected conjunction");
    }
    const defined = required(
      expression.operands.find((item) => item.kind === "field-defined"),
      "Defined clause",
    );
    await expectPublished(
      workspace,
      command("use-not-defined-search", "defined-search", [
        {
          kind: "search-expression-configure",
          searchNodeId: "search",
          expressionId: defined.expressionId,
          clause: { kind: "field-defined", fieldDefinitionId: "status-definition", defined: false },
        },
      ]),
    );
    expect(await resultNodeIds(workspace, "origin")).toEqual(["effective-candidate"]);
  });

  it("SEARCH-5 rejects granular edits that would leave no valid expression tree", async () => {
    const workspace = await setup();
    await createSearchFixture(workspace);
    await expectPublished(
      workspace,
      command("create-negated-expression", "search-validation", [
        {
          kind: "search-expression-create",
          searchNodeId: "search",
          expression: { kind: "not", operand: { kind: "text", text: "archived" } },
          anchor: end,
        },
      ]),
    );
    const expression = required(
      (await searchProjection(workspace)).searchExpressions.search?.expression,
      "Search Expression",
    );
    if (expression.kind !== "not") {
      throw new Error("Expected negation");
    }

    const addOperand = await workspace.execute(
      command("overfill-negation", "search-validation", [
        {
          kind: "search-expression-add",
          searchNodeId: "search",
          parentExpressionId: expression.expressionId,
          expression: { kind: "text", text: "current" },
          anchor: end,
        },
      ]),
    );
    expect(addOperand).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });

    const removeOperand = await workspace.execute(
      command("empty-negation", "search-validation", [
        { kind: "search-expression-remove", searchNodeId: "search", expressionId: expression.operand.expressionId },
      ]),
    );
    expect(removeOperand).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });

    const discardOperand = await workspace.execute(
      command("discard-negation-operand", "search-validation", [
        {
          kind: "search-expression-configure",
          searchNodeId: "search",
          expressionId: expression.expressionId,
          clause: { kind: "text", text: "current" },
        },
      ]),
    );
    expect(discardOperand).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });
  });
});

async function setup(documents: InMemoryDocumentStore = new InMemoryDocumentStore(), loroPeerId: `${number}` = "201") {
  return (await openSearchWorkspace(documents, loroPeerId)).workspace;
}

async function openSearchWorkspace(documents: InMemoryDocumentStore, loroPeerId: `${number}`) {
  const facts = await FactAuthority.open({ workspaceId: "workspace", loroPeerId, documents });
  return { facts, workspace: await Workspace.open({ workspaceId: "workspace", facts, versions }) };
}

async function createSearchFixture(workspace: Workspace): Promise<void> {
  await expectPublished(
    workspace,
    command("fixture", "setup", [
      nodeAt("base-supertag", "workspace", "base-supertag-original", "supertag-definition"),
      nodeAt("subtype-supertag", "workspace", "subtype-supertag-original", "supertag-definition"),
      nodeAt("search", "workspace", "search-original", "search"),
      nodeAt("base-candidate", "workspace", "base-candidate-original"),
      nodeAt("subtype-candidate", "workspace", "subtype-candidate-original"),
      { kind: "supertag-extension-add", supertagId: "subtype-supertag", baseSupertagId: "base-supertag", anchor: end },
      createSupertagApplication("base-candidate", "base-supertag"),
      createSupertagApplication("subtype-candidate", "subtype-supertag"),
    ]),
  );
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
        kind: "rich-text-splice",
        nodeId: "matching-candidate",
        deleteAtomIds: [],
        anchor: end,
        insert: "Urgent current item",
      },
      {
        kind: "rich-text-splice",
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
        kind: "field-datatype-configure",
        fieldDefinitionId: "date-field",
        datatypeNodeId: FIELD_DATATYPE_NODE_IDS.date,
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

function dateValue(ownerNodeId: string, prefix: string, value: string): EditCommand["actions"][number] {
  return {
    kind: "field-date-value-set",
    ownerNodeId,
    fieldDefinitionId: "date-field",
    valueNodeId: `${prefix}-date-value`,
    valueOccurrenceId: `${prefix}-date-value-occurrence`,
    value,
  };
}

function composedExpression() {
  return {
    kind: "and" as const,
    operands: [
      { kind: "supertag" as const, supertagId: "base-supertag" },
      {
        kind: "or" as const,
        operands: [
          { kind: "text" as const, text: "urgent" },
          { kind: "field-defined" as const, fieldDefinitionId: "date-field", defined: true },
        ],
      },
      { kind: "not" as const, operand: { kind: "text" as const, text: "archived" } },
      { kind: "date-compare" as const, fieldDefinitionId: "date-field", operator: "lt" as const, date: "2026-09-01" },
      { kind: "descendant-of" as const, target: { kind: "node" as const, nodeId: "project" } },
      { kind: "links-to" as const, targetNodeId: "linked-target" },
      {
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
): EditCommand["actions"][number] {
  return {
    kind: "node-create",
    nodeId,
    occurrenceId,
    parentNodeId,
    anchor: end,
    ...(intrinsicNodeType ? { intrinsicNodeType } : {}),
  };
}

function command(
  invocationId: string,
  historyChannelId: string,
  actions: EditCommand["actions"],
  intent: EditCommand["intent"] = "direct",
): EditCommand {
  return { kind: "edit", workspaceId: "workspace", invocationId, actorId: "actor", intent, historyChannelId, actions };
}

async function searchResults(workspace: Workspace, perspective: "origin" | "review"): Promise<SearchResultsResult> {
  return workspace.query({ kind: "search-results", workspaceId: "workspace", perspective, searchNodeId: "search" });
}

async function resultNodeIds(workspace: Workspace, perspective: "origin" | "review"): Promise<readonly string[]> {
  return (await searchResults(workspace, perspective)).results.map((result) => result.targetNodeId);
}

async function searchProjection(workspace: Workspace) {
  const [roots, owners, expressions] = await Promise.all([
    workspace.query({ kind: "projection", workspaceId: "workspace", perspective: "origin", section: "metanodes" }),
    workspace.query({ kind: "projection", workspaceId: "workspace", perspective: "origin", section: "nodeOwners" }),
    workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "searchExpressions",
    }),
  ]);
  if (!("metanodes" in roots) || !("nodeOwners" in owners) || !("searchExpressions" in expressions)) {
    throw new Error("Expected Search Projection sections");
  }
  return {
    metanodes: roots.metanodes,
    nodeOwners: owners.nodeOwners,
    searchExpressions: expressions.searchExpressions,
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
      { kind: "rich-text-splice", nodeId, deleteAtomIds, anchor: end, insert: value },
    ]),
  );
}

function searchExpressionIds(expression: SearchExpressionSpec | undefined): readonly string[] {
  if (expression === undefined) {
    return [];
  }
  if (expression.kind === "and" || expression.kind === "or") {
    return [expression.expressionId, ...expression.operands.flatMap(searchExpressionIds)];
  }
  if (expression.kind === "not") {
    return [expression.expressionId, ...searchExpressionIds(expression.operand)];
  }
  return [expression.expressionId];
}

async function acceptAllHunks(workspace: Workspace, invocationId: string): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    const review = await workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in review) || review.hunks.length === 0) {
      return;
    }
    await expectPublished(workspace, {
      kind: "resolve-review",
      workspaceId: "workspace",
      invocationId: `${invocationId}-${index}`,
      actorId: "reviewer",
      decision: "accept",
      selection: required(review.hunks[0], "Review Hunk").selection,
    });
  }
  throw new Error("Review did not converge");
}

async function historySelection(workspace: Workspace, channelId: string, operation: "undo" | "redo") {
  const history = await workspace.query({ kind: "history", workspaceId: "workspace", channelId });
  if (!(operation in history) || history[operation] === null) {
    throw new Error(`Expected Search ${operation}`);
  }
  return history[operation];
}

async function expectPublished(workspace: Workspace, command: Parameters<Workspace["execute"]>[0]): Promise<void> {
  const result = await workspace.execute(command);
  if (result.status === "rejected") {
    throw new Error(JSON.stringify(result.error));
  }
  expect(result.status).toBe("published");
}

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}
