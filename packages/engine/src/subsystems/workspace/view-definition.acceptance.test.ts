import { describe, expect, it } from "vitest";

import type { EditCommand, ViewRowsResult } from "@lode/sdk";
import { createSupertagApplication } from "../../../tests/support/workspace/edit-test-actions.js";
import { FIELD_DATATYPE_NODE_IDS } from "../../domain/fact/index.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import { InMemoryDocumentStore } from "../persistence/in-memory-document-store.js";
import { FactAuthority } from "./authority/fact-authority.js";
import { Workspace } from "./workspace.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("View Definition product model", () => {
  it("VIEW-1 applies one shared default to ordinary and Search sources and preserves it while the host is trashed", async () => {
    const workspace = await setup();
    await createFixture(workspace);

    const implicit = await viewRows(workspace, "host", "origin");
    expect(implicit).toMatchObject({ viewDefinitionNodeId: null, viewType: "outline", available: true });
    expect(implicit.rows.map(sourceIdentity)).toEqual(["occurrence:child-a-original", "occurrence:child-b-original"]);

    await execute(workspace, command("propose-host-view", "host-view", [viewCreate("host", "table")], "proposal"));
    expect(await viewRows(workspace, "host", "origin")).toMatchObject({ viewDefinitionNodeId: null });
    expect(await viewRows(workspace, "host", "review")).toMatchObject({ viewType: "table" });
    await acceptAllHunks(workspace, "accept-host-view");

    const hostView = await sharedView(workspace, "host");
    expect(await viewRows(workspace, "host", "origin")).toMatchObject({
      viewDefinitionNodeId: hostView.viewDefinitionNodeId,
      viewType: "table",
      available: true,
    });

    const searchViewId = await createView(workspace, "search", "table", "search-view");
    await execute(
      workspace,
      command("filter-search-view", "search-view", [
        {
          kind: "view-filter-create",
          hostNodeId: "search",
          viewId: searchViewId,
          expression: { kind: "text", text: "candidate" },
          anchor: end,
        },
      ]),
    );
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

    await execute(workspace, command("trash-host", "host", [{ kind: "node-delete", nodeId: "host" }]));
    expect(await viewRows(workspace, "host", "origin")).toMatchObject({ available: false, rows: [] });
    await execute(
      workspace,
      command("restore-host", "host", [
        { kind: "node-restore", nodeId: "host", occurrenceId: "host-original", parentNodeId: "workspace", anchor: end },
      ]),
    );
    expect(await viewRows(workspace, "host", "origin")).toMatchObject({
      available: true,
      viewDefinitionNodeId: hostView.viewDefinitionNodeId,
      viewType: "table",
    });
  });

  it("VIEW-2 changes mode through Proposal and History while retaining semantic View identity", async () => {
    const workspace = await setup();
    await execute(workspace, command("host", "setup", [nodeAt("host", "workspace", "host-original")]));
    const viewId = await createView(workspace, "host", "outline", "view-mode");

    await execute(
      workspace,
      command(
        "propose-table-mode",
        "view-mode",
        [{ kind: "view-mode-set", hostNodeId: "host", viewId, viewType: "table" }],
        "proposal",
      ),
    );
    expect(await viewRows(workspace, "host", "origin")).toMatchObject({ viewType: "outline" });
    expect(await viewRows(workspace, "host", "review")).toMatchObject({ viewType: "table" });
    await acceptAllHunks(workspace, "accept-table-mode");

    await execute(
      workspace,
      command("outline-mode", "view-mode", [
        { kind: "view-mode-set", hostNodeId: "host", viewId, viewType: "outline" },
      ]),
    );
    expect((await sharedView(workspace, "host")).viewId).toBe(viewId);
    expect(await viewRows(workspace, "host", "origin")).toMatchObject({ viewType: "outline" });

    const undo = await historySelection(workspace, "view-mode", "undo");
    await execute(workspace, {
      kind: "undo",
      workspaceId: "workspace",
      invocationId: "undo-view-mode",
      actorId: "actor",
      selection: undo,
    });
    expect(await viewRows(workspace, "host", "origin")).toMatchObject({ viewType: "table" });

    const redo = await historySelection(workspace, "view-mode", "redo");
    await execute(workspace, {
      kind: "redo",
      workspaceId: "workspace",
      invocationId: "redo-view-mode",
      actorId: "actor",
      selection: redo,
    });
    expect(await viewRows(workspace, "host", "origin")).toMatchObject({ viewType: "outline" });

    const updated = await workspace.execute(
      command("ordered-mode-updates", "view-mode", [
        { kind: "view-mode-set", hostNodeId: "host", viewId, viewType: "table" },
        { kind: "view-mode-set", hostNodeId: "host", viewId, viewType: "outline" },
      ]),
    );
    if (updated.status !== "published") {
      throw new Error(JSON.stringify(updated));
    }
    const secondFactId = required(updated.receipt.factIds[1], "second View mode Fact");
    const second = workspace.facts.snapshot().facts.find((fact) => fact.id === secondFactId);
    expect(second?.body.kind === "edit" ? second.body.actions[0] : null).toEqual({
      kind: "view-mode-set",
      viewId,
      viewType: "outline",
    });
  });

  it("VIEW-3 removes and restores the current shared default through Direct, Proposal, and History", async () => {
    const workspace = await setup();
    await execute(workspace, command("host", "setup", [nodeAt("host", "workspace", "host-original")]));
    const firstViewId = await createView(workspace, "host", "table", "view-lifecycle");

    await execute(
      workspace,
      command("remove-view", "view-lifecycle", [{ kind: "shared-default-view-remove", hostNodeId: "host" }]),
    );
    expect(await viewRows(workspace, "host", "origin")).toMatchObject({
      viewDefinitionNodeId: null,
      viewType: "outline",
    });

    const staleMode = await workspace.execute(
      command("change-removed-view-mode", "view-lifecycle", [
        { kind: "view-mode-set", hostNodeId: "host", viewId: firstViewId, viewType: "outline" },
      ]),
    );
    expect(staleMode).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });

    await execute(workspace, {
      kind: "undo",
      workspaceId: "workspace",
      invocationId: "undo-view-removal",
      actorId: "actor",
      selection: await historySelection(workspace, "view-lifecycle", "undo"),
    });
    expect((await sharedView(workspace, "host")).viewId).toBe(firstViewId);

    await execute(workspace, {
      kind: "redo",
      workspaceId: "workspace",
      invocationId: "redo-view-removal",
      actorId: "actor",
      selection: await historySelection(workspace, "view-lifecycle", "redo"),
    });
    expect(await viewRows(workspace, "host", "origin")).toMatchObject({ viewDefinitionNodeId: null });

    const secondViewId = await createView(workspace, "host", "table", "view-reapplication");
    expect(secondViewId).not.toBe(firstViewId);
    await execute(
      workspace,
      command(
        "propose-remove-reapplied-view",
        "view-proposal",
        [{ kind: "shared-default-view-remove", hostNodeId: "host" }],
        "proposal",
      ),
    );
    expect((await sharedView(workspace, "host", "origin")).viewId).toBe(secondViewId);
    expect(await viewRows(workspace, "host", "review")).toMatchObject({ viewDefinitionNodeId: null });
    await acceptAllHunks(workspace, "accept-view-removal");
    expect(await viewRows(workspace, "host", "origin")).toMatchObject({ viewDefinitionNodeId: null });
  });

  it("VIEW-4 independently projects columns, Search filter, Date sort, and grouping and restores them after restart", async () => {
    const documents = new InMemoryDocumentStore();
    const workspace = await setup(documents, "401");
    await createTableFixture(workspace);
    const viewId = await createView(workspace, "host", "table", "view-options");

    await execute(
      workspace,
      command(
        "propose-view-options",
        "view-options",
        [
          { kind: "view-column-add", hostNodeId: "host", viewId, fieldDefinitionId: "status-field", anchor: end },
          { kind: "view-column-add", hostNodeId: "host", viewId, fieldDefinitionId: "date-field", anchor: end },
          {
            kind: "view-filter-create",
            hostNodeId: "host",
            viewId,
            expression: {
              kind: "field-value",
              fieldDefinitionId: "status-field",
              value: { kind: "text", value: "Backlog" },
            },
            anchor: end,
          },
          {
            kind: "view-sort-add",
            hostNodeId: "host",
            viewId,
            fieldDefinitionId: "date-field",
            direction: "descending",
          },
          { kind: "view-group-add", hostNodeId: "host", viewId, fieldDefinitionId: "status-field" },
        ],
        "proposal",
      ),
    );
    expect((await viewRows(workspace, "host", "origin")).rows.map((row) => row.targetNodeId)).toEqual([
      "row-a",
      "row-b",
      "row-c",
    ]);
    const review = await viewRows(workspace, "host", "review");
    expect(review.rows.map((row) => row.targetNodeId)).toEqual(["row-c", "row-a"]);
    expect(review.rows.map((row) => row.group?.key)).toEqual(["backlog", "backlog"]);
    expect(review.options.columns.map((column) => column.fieldDefinitionId)).toEqual(["status-field", "date-field"]);
    expect(review.options.columns.every((column) => column.columnId.includes("/actions/"))).toBe(true);
    expect(review.options.filter?.expression).toMatchObject({ kind: "field-value", fieldDefinitionId: "status-field" });
    expect(review.options.sort).toMatchObject({ fieldDefinitionId: "date-field", direction: "descending" });
    expect(review.options.group).toMatchObject({ fieldDefinitionId: "status-field" });

    await acceptAllHunks(workspace, "accept-view-options");
    expect((await viewRows(workspace, "host", "origin")).rows.map((row) => row.targetNodeId)).toEqual([
      "row-c",
      "row-a",
    ]);

    const filter = required((await sharedView(workspace, "host")).options.filter, "View Filter");
    await execute(
      workspace,
      command(
        "configure-view-filter",
        "view-options",
        [
          {
            kind: "view-filter-expression-configure",
            hostNodeId: "host",
            viewId,
            filterId: filter.filterId,
            expressionId: filter.expression.expressionId,
            clause: {
              kind: "field-value",
              fieldDefinitionId: "status-field",
              value: { kind: "text", value: "Done" },
            },
          },
        ],
        "proposal",
      ),
    );
    expect((await viewRows(workspace, "host", "origin")).rows.map((row) => row.targetNodeId)).toEqual([
      "row-c",
      "row-a",
    ]);
    expect((await viewRows(workspace, "host", "review")).rows.map((row) => row.targetNodeId)).toEqual(["row-b"]);
    await acceptAllHunks(workspace, "accept-view-filter-configuration");
    expect((await viewRows(workspace, "host", "origin")).rows.map((row) => row.targetNodeId)).toEqual(["row-b"]);
    await execute(
      workspace,
      command("restore-view-filter-clause", "view-options", [
        {
          kind: "view-filter-expression-configure",
          hostNodeId: "host",
          viewId,
          filterId: filter.filterId,
          expressionId: filter.expression.expressionId,
          clause: {
            kind: "field-value",
            fieldDefinitionId: "status-field",
            value: { kind: "text", value: "Backlog" },
          },
        },
      ]),
    );

    await execute(
      workspace,
      command("remove-view-filter", "view-options", [{ kind: "view-filter-remove", hostNodeId: "host", viewId }]),
    );
    expect((await viewRows(workspace, "host", "origin")).rows.map((row) => row.targetNodeId)).toEqual([
      "row-c",
      "row-a",
      "row-b",
    ]);

    await execute(workspace, {
      kind: "undo",
      workspaceId: "workspace",
      invocationId: "undo-view-filter-removal",
      actorId: "actor",
      selection: await historySelection(workspace, "view-options", "undo"),
    });
    expect((await viewRows(workspace, "host", "origin")).rows.map((row) => row.targetNodeId)).toEqual([
      "row-c",
      "row-a",
    ]);

    const restarted = await setup(documents, "402");
    const restored = await viewRows(restarted, "host", "origin");
    expect(restored.rows.map((row) => row.targetNodeId)).toEqual(["row-c", "row-a"]);
    expect(restored.options.columns.map((column) => column.columnId)).toEqual(
      (await viewRows(workspace, "host", "origin")).options.columns.map((column) => column.columnId),
    );
    expect(restored.options.sort?.sortId).toBe((await viewRows(workspace, "host", "origin")).options.sort?.sortId);
  });
});

async function setup(
  documents: InMemoryDocumentStore = new InMemoryDocumentStore(),
  loroPeerId: `${number}` = "301",
): Promise<Workspace> {
  const facts = await FactAuthority.open({ workspaceId: "workspace", loroPeerId, documents });
  return Workspace.open({ workspaceId: "workspace", facts, versions });
}

async function createFixture(workspace: Workspace): Promise<void> {
  await execute(
    workspace,
    command("fixture", "setup", [
      nodeAt("host", "workspace", "host-original"),
      nodeAt("child-a", "host", "child-a-original"),
      nodeAt("child-b", "host", "child-b-original"),
      nodeAt("supertag", "workspace", "supertag-original", "supertag-definition"),
      nodeAt("candidate", "workspace", "candidate-original"),
      { kind: "rich-text-splice", nodeId: "candidate", deleteAtomIds: [], anchor: end, insert: "Candidate" },
      nodeAt("search", "workspace", "search-original", "search"),
      createSupertagApplication("candidate", "supertag"),
    ]),
  );
  await execute(
    workspace,
    command("search-expression", "search", [
      {
        kind: "search-expression-create",
        searchNodeId: "search",
        expression: { kind: "supertag", supertagId: "supertag" },
        anchor: end,
      },
    ]),
  );
}

async function createTableFixture(workspace: Workspace): Promise<void> {
  await execute(
    workspace,
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
  await execute(
    workspace,
    command("configure-view-date", "setup", [
      {
        kind: "field-datatype-configure",
        fieldDefinitionId: "date-field",
        datatypeNodeId: FIELD_DATATYPE_NODE_IDS.date,
      },
    ]),
  );
  await execute(
    workspace,
    command("set-view-dates", "setup", [
      dateValue("row-a", "2026-08-18"),
      dateValue("row-b", "2026-08-19"),
      dateValue("row-c", "2026-08-20"),
    ]),
  );
}

function plainField(ownerNodeId: string, prefix: string, value: string): EditCommand["actions"] {
  const fieldNodeId = `${ownerNodeId}-${prefix}-field`;
  const fieldOccurrenceId = `${fieldNodeId}-occurrence`;
  const valueNodeId = `${ownerNodeId}-${prefix}-value`;
  return [
    nodeAt(fieldNodeId, ownerNodeId, fieldOccurrenceId),
    nodeAt(valueNodeId, fieldNodeId, `${valueNodeId}-occurrence`),
    { kind: "rich-text-splice", nodeId: valueNodeId, deleteAtomIds: [], anchor: end, insert: value },
    { kind: "field-materialize", ownerNodeId, fieldDefinitionId: "status-field", fieldNodeId, fieldOccurrenceId },
  ];
}

function dateValue(ownerNodeId: string, value: string): EditCommand["actions"][number] {
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

async function createView(
  workspace: Workspace,
  hostNodeId: string,
  viewType: "outline" | "table",
  historyChannelId: string,
) {
  await execute(
    workspace,
    command(`create-view-${hostNodeId}-${historyChannelId}`, historyChannelId, [viewCreate(hostNodeId, viewType)]),
  );
  return (await sharedView(workspace, hostNodeId)).viewId;
}

function viewCreate(hostNodeId: string, viewType: "outline" | "table"): EditCommand["actions"][number] {
  return { kind: "shared-default-view-create", hostNodeId, viewType, anchor: end };
}

async function sharedView(workspace: Workspace, hostNodeId: string, perspective: "origin" | "review" = "origin") {
  const result = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective,
    section: "sharedDefaultViewDefinitions",
  });
  if (!("sharedDefaultViewDefinitions" in result)) {
    throw new Error("Expected View Definition Projection");
  }
  return required(result.sharedDefaultViewDefinitions[hostNodeId]?.[0], "shared View Definition");
}

async function acceptAllHunks(workspace: Workspace, invocationId: string): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    const review = await workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in review) || review.hunks.length === 0) {
      return;
    }
    await execute(workspace, {
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
    throw new Error(`Expected View ${operation}`);
  }
  return history[operation];
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
    ...(intrinsicNodeType === undefined ? {} : { intrinsicNodeType }),
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

async function execute(workspace: Workspace, command: Parameters<Workspace["execute"]>[0]): Promise<void> {
  const result = await workspace.execute(command);
  expect(result, JSON.stringify(result)).toMatchObject({ status: "published" });
}

function viewRows(workspace: Workspace, hostNodeId: string, perspective: "origin" | "review"): Promise<ViewRowsResult> {
  return workspace.query({ kind: "view-rows", workspaceId: "workspace", perspective, hostNodeId });
}

function sourceIdentity(row: ViewRowsResult["rows"][number]): string {
  return `${row.sourceKind}:${row.sourceIdentity}`;
}

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}
