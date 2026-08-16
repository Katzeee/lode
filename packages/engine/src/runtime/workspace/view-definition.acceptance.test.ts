import { describe, expect, it } from "vitest";

import type { MutationCommand, ViewRowsResult } from "@lode/sdk";
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

    await createView(workspace, "search", "search-view", "outline", "search-view-history", "search-configuration");
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
    if (viewDeletion.status === "rejected") {
      throw new Error(JSON.stringify(viewDeletion.error));
    }
    expect(await viewRows(workspace, "host", "origin")).toMatchObject({
      available: true,
      viewDefinitionNodeId: null,
      viewType: "outline",
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
});

async function setup(): Promise<ProposalWorkspace> {
  const facts = await FactAuthorityStore.open({
    workspaceId: "workspace",
    replicaId: createReplicaId(),
    loroPeerId: "301",
    documents: new InMemoryDocumentStore(),
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
      nodeAt("search", "workspace", "search-original", "search"),
      { kind: "supertag-apply", nodeId: "candidate", supertagId: "supertag", anchor: end },
    ]),
  );
  await workspace.execute(
    command("search-clause", "search", [
      {
        kind: "search-supertag-clause-create",
        searchNodeId: "search",
        metanodeId: "search-configuration",
        clauseNodeId: "search-clause",
        clauseOccurrenceId: "search-clause-occurrence",
        supertagId: "supertag",
        anchor: end,
      },
    ]),
  );
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
    viewDefinitionNodeId,
    viewDefinitionOccurrenceId: `${viewDefinitionNodeId}-occurrence`,
    viewType,
    anchor: end,
  };
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
  expect(owners.nodeOwners["host-view"]).toBe("host-view-configuration");
  expect(Object.values(occurrences.occurrences).some((item) => item.nodeId === "host-view-configuration")).toBe(false);
}

async function projection<Section extends "sharedDefaultViewDefinitions" | "metanodes" | "nodeOwners" | "occurrences">(
  workspace: ProposalWorkspace,
  section: Section,
) {
  const result = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective: "origin",
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
  nodeType?: "supertag-definition" | "search",
) {
  return {
    kind: "node-create" as const,
    nodeId,
    occurrenceId,
    parentNodeId,
    anchor: end,
    ...(nodeType === undefined ? {} : { nodeType }),
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
