import { describe, expect, it } from "vitest";
import { createSupertagApplication } from "../../../tests/support/workspace/edit-test-mutations.js";
import {
  detachedViewValueNodeId,
  detachedViewValueOccurrenceId,
  FIELD_DATATYPE_NODE_IDS,
  workspaceTrashNodeId,
} from "../../domain/fact/index.js";

import type { MutationCommand, ViewOptionsSpec, ViewRowsResult } from "@lode/sdk";
import { admitAuthorityRecords } from "../../domain/admission/index.js";
import { InMemoryDocumentStore } from "../../persistence/in-memory-document-store.js";
import { createReplicaId, FactAuthorityStore } from "../authority/fact-authority-store.js";
import { ProposalWorkspace } from "./proposal-workspace.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("View Definition product model", () => {
  it("VIEW-1 applies one shared default to ordinary and Search child sources across Review and Trash", async () => {
    const workspace = await setup();
    await createFixture(workspace);
    const implicit = await viewRows(workspace, "host", "origin");
    expect(implicit).toMatchObject({ viewDefinitionNodeId: null, viewType: "outline", available: true });
    expect(implicit.rows.map(sourceIdentity)).toEqual(["occurrence:child-a-original", "occurrence:child-b-original"]);

    await proposeAndAcceptHostView(workspace);
    const ordinary = await viewRows(workspace, "host", "origin");
    expect(ordinary).toMatchObject({ viewDefinitionNodeId: "host-view", viewType: "table", available: true });
    expect(ordinary.rows.map(sourceIdentity)).toEqual(["occurrence:child-a-original", "occurrence:child-b-original"]);
    await expectHiddenViewDefinition(workspace);

    await createView(workspace, "search", "search-view", "table", "search-view-history", "search-configuration");
    const search = await workspace.query({
      kind: "search-results",
      workspaceId: "workspace",
      perspective: "origin",
      searchNodeId: "search",
    });
    const viewedSearch = await viewRows(workspace, "search", "origin");
    expect(viewedSearch.rows).toHaveLength(1);
    expect(viewedSearch.rows[0]).toMatchObject({
      targetNodeId: "candidate",
      sourceKind: "search-result",
      sourceIdentity: search.results[0]?.rowKey,
    });
    expect(
      (
        await workspace.execute(
          command("filter-search-view", "search-view-history", [
            {
              kind: "shared-default-view-definition-options-update",
              hostNodeId: "search",
              viewDefinitionNodeId: "search-view",
              options: {
                columns: [],
                filter: {
                  filterNodeId: "search-view-filter",
                  expression: { expressionNodeId: "search-view-text", kind: "text", text: "candidate" },
                },
                sort: null,
                group: null,
              },
            },
          ]),
        )
      ).status,
    ).toBe("published");
    expect((await viewRows(workspace, "search", "origin")).rows.map((row) => row.targetNodeId)).toEqual(["candidate"]);

    const deletion = await workspace.execute(command("trash-host", "host", [{ kind: "node-delete", nodeId: "host" }]));
    if (deletion.status !== "published") {
      throw new Error("Expected View host deletion");
    }
    expect(await viewRows(workspace, "host", "origin")).toMatchObject({ available: false, rows: [] });
    await workspace.execute(
      command("restore-host", "host", [
        {
          kind: "node-restore",
          nodeId: "host",
          deletionFactId: required(deletion.receipt.factIds[0], "View host deletion Fact"),
          occurrenceId: "host-original",
          ownerNodeId: "workspace",
          parentNodeId: "workspace",
          anchor: end,
        },
      ]),
    );
    expect(await viewRows(workspace, "host", "origin")).toMatchObject({
      available: true,
      viewDefinitionNodeId: "host-view",
      viewType: "table",
    });

    const viewDeletion = await workspace.execute(
      command("remove-host-view", "host-view", [{ kind: "node-delete", nodeId: "host-view" }]),
    );
    expect(viewDeletion).toMatchObject({
      status: "rejected",
      error: { message: "Structural role requires a typed mutation: Node host-view" },
    });
    expect(await viewRows(workspace, "host", "origin")).toMatchObject({
      available: true,
      viewDefinitionNodeId: "host-view",
      viewType: "table",
    });
  });

  it("VIEW-2 changes mode through public Proposal and History while preserving View Definition identity", async () => {
    const workspace = await setup();
    await workspace.execute(command("host", "setup", [nodeAt("host", "workspace", "host-original")]));
    await createView(workspace, "host", "host-view", "outline", "view-create");

    await workspace.execute(
      command(
        "table-mode",
        "view-mode",
        [{ kind: "shared-default-view-definition-mode-set", viewDefinitionNodeId: "host-view", viewType: "table" }],
        "proposal",
      ),
    );
    expect(await viewRows(workspace, "host", "origin")).toMatchObject({ viewType: "outline" });
    expect(await viewRows(workspace, "host", "review")).toMatchObject({ viewType: "table" });
    await acceptFirstHunk(workspace, "accept-table-mode");
    expect(await viewRows(workspace, "host", "origin")).toMatchObject({
      viewDefinitionNodeId: "host-view",
      viewType: "table",
    });

    await workspace.execute(
      command("outline-mode", "view-mode", [
        { kind: "shared-default-view-definition-mode-set", viewDefinitionNodeId: "host-view", viewType: "outline" },
      ]),
    );
    expect(await viewRows(workspace, "host", "origin")).toMatchObject({ viewType: "outline" });

    const history = await workspace.query({ kind: "history", workspaceId: "workspace", channelId: "view-mode" });
    if (!("undo" in history) || !history.undo) {
      throw new Error("Expected View mode Undo");
    }
    await workspace.execute({
      kind: "undo",
      workspaceId: "workspace",
      invocationId: "undo-view-mode",
      actorId: "actor",
      selection: history.undo,
    });
    expect(await viewRows(workspace, "host", "origin")).toMatchObject({
      viewDefinitionNodeId: "host-view",
      viewType: "table",
    });

    const redo = await workspace.query({ kind: "history", workspaceId: "workspace", channelId: "view-mode" });
    if (!("redo" in redo) || !redo.redo) {
      throw new Error("Expected View mode Redo");
    }
    await workspace.execute({
      kind: "redo",
      workspaceId: "workspace",
      invocationId: "redo-view-mode",
      actorId: "actor",
      selection: redo.redo,
    });
    expect(await viewRows(workspace, "host", "origin")).toMatchObject({
      viewDefinitionNodeId: "host-view",
      viewType: "outline",
    });
  });

  it("VIEW-3 removes the shared default through graph truth across Direct, Proposal, History, and reapplication", async () => {
    const workspace = await setup();
    await workspace.execute(command("host", "setup", [nodeAt("host", "workspace", "host-original")]));
    await createView(workspace, "host", "host-view", "table", "view-lifecycle");

    const removed = await workspace.execute(
      command("remove-view", "view-lifecycle", [viewRemoval("host", "host-view")]),
    );
    expect(removed.status).toBe("published");
    expect(await viewRows(workspace, "host", "origin")).toMatchObject({
      viewDefinitionNodeId: null,
      viewType: "outline",
    });
    await expectDetachedViewDefinition(workspace, "host-view");

    const corruption = await workspace.execute(
      command("corrupt-removed-view", "view-lifecycle", [
        { kind: "occurrence-delete", occurrenceId: "host-view-attachment-definition" },
      ]),
    );
    expect(corruption).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });
    await expectDetachedViewDefinition(workspace, "host-view");
    const staleMode = await workspace.execute(
      command("change-removed-view-mode", "view-lifecycle", [
        { kind: "shared-default-view-definition-mode-set", viewDefinitionNodeId: "host-view", viewType: "outline" },
      ]),
    );
    expect(staleMode).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });

    const history = await workspace.query({ kind: "history", workspaceId: "workspace", channelId: "view-lifecycle" });
    if (!("undo" in history) || !history.undo) {
      throw new Error("Expected View removal Undo");
    }
    const undo = await workspace.execute({
      kind: "undo",
      workspaceId: "workspace",
      invocationId: "undo-view-removal",
      actorId: "actor",
      selection: history.undo,
    });
    expect(undo, JSON.stringify(undo)).toMatchObject({ status: "published" });
    expect(await viewRows(workspace, "host", "origin")).toMatchObject({
      viewDefinitionNodeId: "host-view",
      viewType: "table",
    });

    const redo = await workspace.query({ kind: "history", workspaceId: "workspace", channelId: "view-lifecycle" });
    if (!("redo" in redo) || !redo.redo) {
      throw new Error("Expected View removal Redo");
    }
    const redone = await workspace.execute({
      kind: "redo",
      workspaceId: "workspace",
      invocationId: "redo-view-removal",
      actorId: "actor",
      selection: redo.redo,
    });
    expect(redone, JSON.stringify(redone)).toMatchObject({ status: "published" });
    await expectDetachedViewDefinition(workspace, "host-view");

    await createView(workspace, "host", "host-view-2", "table", "view-reapplication");
    expect(await viewRows(workspace, "host", "origin")).toMatchObject({ viewDefinitionNodeId: "host-view-2" });
    await expectDetachedViewDefinition(workspace, "host-view");

    const proposal = await workspace.execute(
      command("propose-remove-reapplied-view", "view-proposal", [viewRemoval("host", "host-view-2")], "proposal"),
    );
    expect(proposal.status).toBe("published");
    expect(await viewRows(workspace, "host", "origin")).toMatchObject({ viewDefinitionNodeId: "host-view-2" });
    expect(await viewRows(workspace, "host", "review")).toMatchObject({ viewDefinitionNodeId: null });
    await expectDetachedViewDefinition(workspace, "host-view-2", "review");
    await acceptFirstHunk(workspace, "accept-view-removal");
    expect(await viewRows(workspace, "host", "origin")).toMatchObject({ viewDefinitionNodeId: null });
    await expectDetachedViewDefinition(workspace, "host-view-2");
  });

  it("VIEW-4 presents typed columns, shared Search filtering, Date sort, and Field groups without copying row content", async () => {
    const workspace = await setup();
    await createTableFixture(workspace);
    await createView(workspace, "host", "host-view", "table", "view-options");
    const beforeOwners = await projection(workspace, "nodeOwners");

    const proposed = await workspace.execute(
      command("propose-view-options", "view-options", [viewOptionsUpdate(tableOptions(true))], "proposal"),
    );
    expect(proposed.status).toBe("published");
    expect((await viewRows(workspace, "host", "origin")).rows.map((row) => row.targetNodeId)).toEqual([
      "row-a",
      "row-b",
      "row-c",
    ]);
    const review = await viewRows(workspace, "host", "review");
    expect(review.options).toEqual(tableOptions(true));
    expect(review.optionsConflicted).toBe(false);
    expect(review.rows.map((row) => row.targetNodeId)).toEqual(["row-c", "row-a"]);
    expect(review.rows.map((row) => row.group?.key)).toEqual(["backlog", "backlog"]);
    expect(review.rows[0]?.cells).toEqual([
      {
        columnNodeId: "status-column",
        fieldDefinitionId: "status-field",
        fieldNodeId: "row-c-status-field",
        valueNodeIds: ["row-c-status-value"],
      },
      {
        columnNodeId: "date-column",
        fieldDefinitionId: "date-field",
        fieldNodeId: "row-c-date-field",
        valueNodeIds: ["row-c-date-value"],
      },
    ]);
    const reviewOwners = await projection(workspace, "nodeOwners", "review");
    expect(reviewOwners.nodeOwners["row-a"]).toBe(beforeOwners.nodeOwners["row-a"]);
    expect(reviewOwners.nodeOwners["status-field"]).toBe(beforeOwners.nodeOwners["status-field"]);
    expect(reviewOwners.nodeOwners["row-a-status-value"]).toBe(beforeOwners.nodeOwners["row-a-status-value"]);
    expect(reviewOwners.nodeOwners["status-column"]).toBeUndefined();
    expect(reviewOwners.nodeOwners["filter-rule"]).toBeUndefined();

    await acceptFirstHunk(workspace, "accept-view-options");
    expect((await viewRows(workspace, "host", "origin")).rows.map((row) => row.targetNodeId)).toEqual([
      "row-c",
      "row-a",
    ]);

    expect(
      (await workspace.execute(command("remove-view-filter", "view-options", [viewOptionsUpdate(tableOptions(false))])))
        .status,
    ).toBe("published");

    const history = await workspace.query({ kind: "history", workspaceId: "workspace", channelId: "view-options" });
    if (!("undo" in history) || history.undo === null) {
      throw new Error("Expected View options Undo");
    }
    expect(
      (
        await workspace.execute({
          kind: "undo",
          workspaceId: "workspace",
          invocationId: "undo-view-options",
          actorId: "actor",
          selection: history.undo,
        })
      ).status,
    ).toBe("published");
    expect((await viewRows(workspace, "host", "origin")).options).toEqual(tableOptions(true));
    const redo = await workspace.query({ kind: "history", workspaceId: "workspace", channelId: "view-options" });
    if (!("redo" in redo) || redo.redo === null) {
      throw new Error("Expected View options Redo");
    }
    expect(
      (
        await workspace.execute({
          kind: "redo",
          workspaceId: "workspace",
          invocationId: "redo-view-options",
          actorId: "actor",
          selection: redo.redo,
        })
      ).status,
    ).toBe("published");

    const unfiltered = await viewRows(workspace, "host", "origin");
    expect(unfiltered.rows.map((row) => row.targetNodeId)).toEqual(["row-c", "row-a", "row-b"]);
    expect(unfiltered.options.columns.map((column) => column.columnNodeId)).toEqual(["status-column", "date-column"]);
    expect(unfiltered.options.sort?.sortNodeId).toBe("date-sort");
    expect(unfiltered.options.group?.groupNodeId).toBe("status-group");
    expect(
      (await workspace.execute(command("readd-view-filter", "view-options", [viewOptionsUpdate(tableOptions(true))])))
        .status,
    ).toBe("published");
    expect((await viewRows(workspace, "host", "origin")).options.filter).toEqual(tableOptions(true).filter);

    const smuggling = await workspace.execute(
      command("view-owner-smuggling", "view-options", [
        { kind: "node-owner-set", nodeId: "status-field", ownerNodeId: "host-view" } as never,
      ]),
    );
    expect(smuggling).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });
    expect((await projection(workspace, "nodeOwners")).nodeOwners["status-field"]).toBe("workspace");
  });

  it("VIEW-5 restores View option identities and derived presentation after restart", async () => {
    const documents = new InMemoryDocumentStore();
    const first = await setup(documents, "401");
    await createTableFixture(first);
    await createView(first, "host", "host-view", "table", "persistent-view-options");
    expect(
      (
        await first.execute(
          command("persistent-view-options", "persistent-view-options", [viewOptionsUpdate(tableOptions(true))]),
        )
      ).status,
    ).toBe("published");
    const restarted = await setup(documents, "402");
    const rows = await viewRows(restarted, "host", "origin");
    expect(rows.options).toEqual(tableOptions(true));
    expect(rows.rows.map((row) => row.targetNodeId)).toEqual(["row-c", "row-a"]);
  });
});

async function setup(
  documents: InMemoryDocumentStore = new InMemoryDocumentStore(),
  loroPeerId: `${number}` = "301",
): Promise<ProposalWorkspace> {
  const facts = await FactAuthorityStore.open({
    workspaceId: "workspace",
    replicaId: createReplicaId(),
    loroPeerId,
    documents,
    admitRecords: admitAuthorityRecords,
  });
  return ProposalWorkspace.open({ workspaceId: "workspace", facts, versions });
}

async function createFixture(workspace: ProposalWorkspace): Promise<void> {
  await workspace.execute(
    command("fixture", "setup", [
      nodeAt("host", "workspace", "host-original"),
      nodeAt("child-a", "host", "child-a-original"),
      nodeAt("child-b", "host", "child-b-original"),
      nodeAt("supertag", "workspace", "supertag-original", "supertag-definition"),
      nodeAt("candidate", "workspace", "candidate-original"),
      { kind: "text-splice", nodeId: "candidate", deleteAtomIds: [], anchor: end, insert: "Candidate" },
      nodeAt("search", "workspace", "search-original", "search"),
      createSupertagApplication("candidate", "supertag"),
    ]),
  );
  await workspace.execute(
    command("search-expression", "search", [
      {
        kind: "search-expression-create",
        searchNodeId: "search",
        metanodeId: "search-configuration",
        expressionNodeId: "search-expression",
        expressionOccurrenceId: "search-expression-occurrence",
        definitionOccurrenceId: "search-expression-definition",
        expression: { expressionNodeId: "search-expression", kind: "supertag", supertagId: "supertag" },
        anchor: end,
      },
    ]),
  );
}

async function createTableFixture(workspace: ProposalWorkspace): Promise<void> {
  const created = await workspace.execute(
    command("table-fixture", "setup", [
      nodeAt("host", "workspace", "host-original"),
      nodeAt("row-a", "host", "row-a-original"),
      nodeAt("row-b", "host", "row-b-original"),
      nodeAt("row-c", "host", "row-c-original"),
      nodeAt("status-field", "workspace", "status-field-original", "field-definition"),
      nodeAt("date-field", "workspace", "date-field-original", "field-definition"),
      ...plainField("row-a", "status", "Backlog"),
      ...plainField("row-b", "status", "Done"),
      ...plainField("row-c", "status", "Backlog"),
    ]),
  );
  if (created.status === "rejected") {
    throw new Error(JSON.stringify(created.error));
  }
  const configured = await workspace.execute(
    command("configure-view-date", "setup", [
      {
        kind: "field-datatype-configuration-create",
        fieldDefinitionId: "date-field",
        configurationNodeId: "date-configuration",
        configurationOccurrenceId: "date-configuration-occurrence",
        definitionOccurrenceId: "date-configuration-definition-occurrence",
        valueOccurrenceId: "date-configuration-value-occurrence",
        datatypeNodeId: FIELD_DATATYPE_NODE_IDS.date,
        anchor: end,
      },
    ]),
  );
  if (configured.status === "rejected") {
    throw new Error(JSON.stringify(configured.error));
  }
  const dated = await workspace.execute(
    command("set-view-dates", "setup", [
      dateValue("row-a", "2026-08-18"),
      dateValue("row-b", "2026-08-19"),
      dateValue("row-c", "2026-08-20"),
    ]),
  );
  if (dated.status === "rejected") {
    throw new Error(JSON.stringify(dated.error));
  }
}

function plainField(ownerNodeId: string, prefix: string, value: string): MutationCommand["mutations"] {
  const fieldNodeId = `${ownerNodeId}-${prefix}-field`;
  const fieldOccurrenceId = `${fieldNodeId}-occurrence`;
  const valueNodeId = `${ownerNodeId}-${prefix}-value`;
  return [
    nodeAt(fieldNodeId, ownerNodeId, fieldOccurrenceId),
    nodeAt(valueNodeId, fieldNodeId, `${valueNodeId}-occurrence`),
    { kind: "text-splice", nodeId: valueNodeId, deleteAtomIds: [], anchor: end, insert: value },
    {
      kind: "field-materialize",
      ownerNodeId,
      fieldDefinitionId: "status-field",
      fieldNodeId,
      fieldOccurrenceId,
    },
  ];
}

function dateValue(ownerNodeId: string, value: string): MutationCommand["mutations"][number] {
  return {
    kind: "field-date-value-set",
    ownerNodeId,
    fieldDefinitionId: "date-field",
    fieldNodeId: `${ownerNodeId}-date-field`,
    fieldOccurrenceId: `${ownerNodeId}-date-field-occurrence`,
    valueNodeId: `${ownerNodeId}-date-value`,
    valueOccurrenceId: `${ownerNodeId}-date-value-occurrence`,
    value,
  };
}

function tableOptions(withFilter: boolean): ViewOptionsSpec {
  return {
    columns: [
      { columnNodeId: "status-column", fieldDefinitionId: "status-field" },
      { columnNodeId: "date-column", fieldDefinitionId: "date-field" },
    ],
    filter: withFilter
      ? {
          filterNodeId: "filter-rule",
          expression: {
            expressionNodeId: "filter-clause",
            kind: "field-value",
            fieldDefinitionId: "status-field",
            value: { kind: "text", value: "Backlog" },
          },
        }
      : null,
    sort: { sortNodeId: "date-sort", fieldDefinitionId: "date-field", direction: "descending" },
    group: { groupNodeId: "status-group", fieldDefinitionId: "status-field" },
  };
}

function viewOptionsUpdate(options: ViewOptionsSpec): MutationCommand["mutations"][number] {
  return {
    kind: "shared-default-view-definition-options-update",
    hostNodeId: "host",
    viewDefinitionNodeId: "host-view",
    options,
  };
}

async function proposeAndAcceptHostView(workspace: ProposalWorkspace): Promise<void> {
  await workspace.execute(
    command("host-view", "host-view-history", [viewCreation("host", "host-view", "table")], "proposal"),
  );
  expect(await viewRows(workspace, "host", "origin")).toMatchObject({ viewDefinitionNodeId: null });
  expect(await viewRows(workspace, "host", "review")).toMatchObject({
    viewDefinitionNodeId: "host-view",
    viewType: "table",
  });
  await acceptFirstHunk(workspace, "accept-host-view");
}

async function acceptFirstHunk(workspace: ProposalWorkspace, invocationId: string): Promise<void> {
  const review = await workspace.query({ kind: "review", workspaceId: "workspace" });
  const viewHunk = "hunks" in review ? review.hunks.find((hunk) => hunk.diffSpace.kind === "view-definition") : null;
  if (!viewHunk) {
    throw new Error("Expected View Review Hunk");
  }
  const result = await workspace.execute({
    kind: "resolve-review",
    workspaceId: "workspace",
    invocationId,
    actorId: "reviewer",
    decision: "accept",
    selection: viewHunk.selection,
  });
  if (result.status === "rejected") {
    throw new Error(JSON.stringify(result.error));
  }
  expect(result.status).toBe("published");
}

async function createView(
  workspace: ProposalWorkspace,
  hostNodeId: string,
  viewDefinitionNodeId: string,
  viewType: "outline" | "table",
  historyChannelId: string,
  metanodeId = `${hostNodeId}-view-configuration`,
): Promise<void> {
  const result = await workspace.execute(
    command(viewDefinitionNodeId, historyChannelId, [
      viewCreation(hostNodeId, viewDefinitionNodeId, viewType, metanodeId),
    ]),
  );
  if (result.status === "rejected") {
    throw new Error(JSON.stringify(result.error));
  }
  expect(result.status).toBe("published");
}

function viewCreation(
  hostNodeId: string,
  viewDefinitionNodeId: string,
  viewType: "outline" | "table",
  metanodeId = `${hostNodeId}-view-configuration`,
) {
  return {
    kind: "shared-default-view-definition-create" as const,
    hostNodeId,
    metanodeId,
    attachmentNodeId: `${viewDefinitionNodeId}-attachment`,
    attachmentOccurrenceId: `${viewDefinitionNodeId}-attachment-occurrence`,
    relationDefinitionOccurrenceId: `${viewDefinitionNodeId}-attachment-definition`,
    viewDefinitionNodeId,
    viewDefinitionOccurrenceId: `${viewDefinitionNodeId}-occurrence`,
    viewType,
    anchor: end,
  };
}

function viewRemoval(hostNodeId: string, viewDefinitionNodeId: string) {
  return {
    kind: "shared-default-view-definition-remove" as const,
    hostNodeId,
    attachmentNodeId: `${viewDefinitionNodeId}-attachment`,
    attachmentOccurrenceId: `${viewDefinitionNodeId}-attachment-occurrence`,
    relationDefinitionOccurrenceId: `${viewDefinitionNodeId}-attachment-definition`,
    viewDefinitionNodeId,
    viewDefinitionOccurrenceId: `${viewDefinitionNodeId}-occurrence`,
  };
}

async function expectDetachedViewDefinition(
  workspace: ProposalWorkspace,
  viewDefinitionNodeId: string,
  perspective: "origin" | "review" = "origin",
): Promise<void> {
  const attachmentNodeId = `${viewDefinitionNodeId}-attachment`;
  const attachmentOccurrenceId = `${viewDefinitionNodeId}-attachment-occurrence`;
  const relationDefinitionOccurrenceId = `${viewDefinitionNodeId}-attachment-definition`;
  const viewDefinitionOccurrenceId = `${viewDefinitionNodeId}-occurrence`;
  const detachedValueNodeId = detachedViewValueNodeId(attachmentNodeId);
  const detachedValueOccurrenceId = detachedViewValueOccurrenceId(attachmentNodeId);
  const [definitions, owners, occurrences, children] = await Promise.all([
    projection(workspace, "sharedDefaultViewDefinitions", perspective),
    projection(workspace, "nodeOwners", perspective),
    projection(workspace, "occurrences", perspective),
    projection(workspace, "childOccurrences", perspective),
  ]);
  expect(Object.values(definitions.sharedDefaultViewDefinitions).flat()).not.toContainEqual(
    expect.objectContaining({ attachmentNodeId }),
  );
  expect(owners.nodeOwners[attachmentNodeId]).toBe(workspaceTrashNodeId("workspace"));
  expect(owners.nodeOwners[viewDefinitionNodeId]).toBe(workspaceTrashNodeId("workspace"));
  expect(owners.nodeOwners[detachedValueNodeId]).toBe(attachmentNodeId);
  expect(occurrences.occurrences[attachmentOccurrenceId]).toMatchObject({
    nodeId: attachmentNodeId,
    parentNodeId: workspaceTrashNodeId("workspace"),
  });
  expect(occurrences.occurrences[viewDefinitionOccurrenceId]).toMatchObject({
    nodeId: viewDefinitionNodeId,
    parentNodeId: workspaceTrashNodeId("workspace"),
  });
  expect(occurrences.occurrences[detachedValueOccurrenceId]).toMatchObject({
    nodeId: detachedValueNodeId,
    parentNodeId: attachmentNodeId,
  });
  expect(children.childOccurrences[attachmentNodeId]).toEqual([
    relationDefinitionOccurrenceId,
    detachedValueOccurrenceId,
  ]);
}

async function expectHiddenViewDefinition(workspace: ProposalWorkspace): Promise<void> {
  const [definitions, roots, owners, occurrences] = await Promise.all([
    projection(workspace, "sharedDefaultViewDefinitions"),
    projection(workspace, "metanodes"),
    projection(workspace, "nodeOwners"),
    projection(workspace, "occurrences"),
  ]);
  expect(definitions.sharedDefaultViewDefinitions.host?.[0]).toMatchObject({
    viewDefinitionNodeId: "host-view",
    viewDefinitionOccurrenceId: "host-view-occurrence",
    viewType: "table",
  });
  expect(roots.metanodes.host).toBe("host-view-configuration");
  expect(owners.nodeOwners["host-view-attachment"]).toBe("host-view-configuration");
  expect(owners.nodeOwners["host-view"]).toBe("host-view-attachment");
  expect(Object.values(occurrences.occurrences).some((item) => item.nodeId === "host-view-configuration")).toBe(false);
}

async function projection<
  Section extends "sharedDefaultViewDefinitions" | "metanodes" | "nodeOwners" | "occurrences" | "childOccurrences",
>(workspace: ProposalWorkspace, section: Section, perspective: "origin" | "review" = "origin") {
  const result = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective,
    section,
  });
  if (!(section in result)) {
    throw new Error(`Expected ${section} Projection section`);
  }
  return result as Extract<typeof result, Record<Section, unknown>>;
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

function viewRows(
  workspace: ProposalWorkspace,
  hostNodeId: string,
  perspective: "origin" | "review",
): Promise<ViewRowsResult> {
  return workspace.query({ kind: "view-rows", workspaceId: "workspace", perspective, hostNodeId });
}

function sourceIdentity(row: ViewRowsResult["rows"][number]): string {
  return `${row.sourceKind}:${row.sourceIdentity}`;
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}
