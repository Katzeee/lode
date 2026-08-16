import { describe, expect, it } from "vitest";

import type { MutationCommand, SearchResultsResult } from "@lode/sdk";
import { admitAuthorityRecords } from "../../domain/admission/index.js";
import { InMemoryDocumentStore } from "../../persistence/in-memory-document-store.js";
import { createReplicaId, FactAuthorityStore } from "../authority/fact-authority-store.js";
import { ProposalWorkspace } from "./proposal-workspace.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("Search Node product model", () => {
  it("SEARCH-1 composes Supertag and defined-Field clauses across Origin, Review, and Trash", async () => {
    const workspace = await setup();
    await createSearchFixture(workspace);
    await workspace.execute(
      command("base-clause", "search", [
        {
          kind: "search-supertag-clause-create",
          searchNodeId: "search",
          metanodeId: "search-configuration",
          clauseNodeId: "base-clause",
          clauseOccurrenceId: "base-clause-occurrence",
          supertagId: "base-supertag",
          anchor: end,
        },
      ]),
    );

    expect(await resultNodeIds(workspace, "origin")).toEqual(["base-candidate", "subtype-candidate"]);
    const proposal = await workspace.execute(
      command(
        "field-clause",
        "search",
        [
          {
            kind: "search-field-clause-create",
            searchNodeId: "search",
            metanodeId: "search-configuration",
            clauseNodeId: "field-clause",
            clauseOccurrenceId: "field-clause-occurrence",
            fieldDefinitionId: "field-definition",
            anchor: end,
          },
        ],
        "proposal",
      ),
    );
    expect(proposal.status).toBe("published");
    expect(await resultNodeIds(workspace, "origin")).toEqual(["base-candidate", "subtype-candidate"]);
    expect(await resultNodeIds(workspace, "review")).toEqual(["subtype-candidate"]);

    const review = await workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in review) || !review.hunks[0]) {
      throw new Error("Expected Search clause Review Hunk");
    }
    expect(
      (
        await workspace.execute({
          kind: "resolve-review",
          workspaceId: "workspace",
          invocationId: "accept-field-clause",
          actorId: "reviewer",
          decision: "accept",
          selection: review.hunks[0].selection,
        })
      ).status,
    ).toBe("published");
    expect(await resultNodeIds(workspace, "origin")).toEqual(["subtype-candidate"]);

    const candidateDeletion = await workspace.execute(
      command("trash-candidate", "candidate", [{ kind: "node-delete", nodeId: "subtype-candidate" }]),
    );
    if (candidateDeletion.status !== "published") {
      throw new Error("Expected Search candidate deletion");
    }
    expect(await resultNodeIds(workspace, "origin")).toEqual([]);
    await workspace.execute(
      command("restore-candidate", "candidate", [
        {
          kind: "node-restore",
          nodeId: "subtype-candidate",
          deletionFactId: required(candidateDeletion.receipt.factIds[0], "candidate deletion Fact"),
        },
      ]),
    );
    expect(await resultNodeIds(workspace, "origin")).toEqual(["subtype-candidate"]);

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
        },
      ]),
    );
    expect(await resultNodeIds(workspace, "origin")).toEqual(["subtype-candidate"]);
  });

  it("SEARCH-2 keeps clause identity and hidden ownership through public Undo and Redo", async () => {
    const workspace = await setup();
    await createSearchFixture(workspace);
    const created = await workspace.execute(
      command("create-clause", "search-history", [
        {
          kind: "search-supertag-clause-create",
          searchNodeId: "search",
          metanodeId: "search-configuration",
          clauseNodeId: "base-clause",
          clauseOccurrenceId: "base-clause-occurrence",
          supertagId: "base-supertag",
          anchor: end,
        },
      ]),
    );
    expect(created.status).toBe("published");
    const projected = await searchProjection(workspace);
    expect(projected.metanodes).toEqual({ search: "search-configuration" });
    expect(projected.nodeOwners["base-clause"]).toBe("search-configuration");
    expect(projected.searchClauses.search).toEqual([
      {
        kind: "supertag-instance-of",
        clauseNodeId: "base-clause",
        clauseOccurrenceId: "base-clause-occurrence",
        supertagId: "base-supertag",
      },
    ]);
    expect(
      Object.values(projected.occurrences).some((occurrence) => occurrence.nodeId === "search-configuration"),
    ).toBe(false);

    const history = await workspace.query({ kind: "history", workspaceId: "workspace", channelId: "search-history" });
    if (!("undo" in history) || !history.undo) {
      throw new Error("Expected Search clause Undo");
    }
    expect(
      (
        await workspace.execute({
          kind: "undo",
          workspaceId: "workspace",
          invocationId: "undo-search-clause",
          actorId: "actor",
          selection: history.undo,
        })
      ).status,
    ).toBe("published");
    expect(await resultNodeIds(workspace, "origin")).toEqual([]);

    const redo = await workspace.query({ kind: "history", workspaceId: "workspace", channelId: "search-history" });
    if (!("redo" in redo) || !redo.redo) {
      throw new Error("Expected Search clause Redo");
    }
    expect(
      (
        await workspace.execute({
          kind: "redo",
          workspaceId: "workspace",
          invocationId: "redo-search-clause",
          actorId: "actor",
          selection: redo.redo,
        })
      ).status,
    ).toBe("published");
    expect((await searchProjection(workspace)).searchClauses.search?.[0]?.clauseNodeId).toBe("base-clause");
    expect(await resultNodeIds(workspace, "origin")).toEqual(["base-candidate", "subtype-candidate"]);
  });
});

async function setup(): Promise<ProposalWorkspace> {
  const facts = await FactAuthorityStore.open({
    workspaceId: "workspace",
    replicaId: createReplicaId(),
    loroPeerId: "201",
    documents: new InMemoryDocumentStore(),
    admitRecords: admitAuthorityRecords,
  });
  return ProposalWorkspace.open({ workspaceId: "workspace", facts, versions });
}

async function createSearchFixture(workspace: ProposalWorkspace): Promise<void> {
  const operations: MutationCommand["mutations"] = [
    nodeAt("base-supertag", "workspace", "base-supertag-original", "supertag-definition"),
    nodeAt("subtype-supertag", "workspace", "subtype-supertag-original", "supertag-definition"),
    nodeAt("field-definition", "workspace", "field-definition-original", "field-definition"),
    nodeAt("search", "workspace", "search-original", "search"),
    nodeAt("base-candidate", "workspace", "base-candidate-original"),
    nodeAt("subtype-candidate", "workspace", "subtype-candidate-original"),
    nodeAt("field-only-candidate", "workspace", "field-only-candidate-original"),
    nodeAt("template-field", "base-supertag", "template-field-occurrence"),
    {
      kind: "supertag-field-add",
      supertagId: "base-supertag",
      fieldDefinitionId: "field-definition",
      fieldNodeId: "template-field",
      fieldOccurrenceId: "template-field-occurrence",
      anchor: end,
    },
    {
      kind: "supertag-extension-add",
      supertagId: "subtype-supertag",
      baseSupertagId: "base-supertag",
      anchor: end,
    },
    { kind: "supertag-apply", nodeId: "base-candidate", supertagId: "base-supertag", anchor: end },
    { kind: "supertag-apply", nodeId: "subtype-candidate", supertagId: "subtype-supertag", anchor: end },
    nodeAt("subtype-field", "subtype-candidate", "subtype-field-occurrence"),
    {
      kind: "field-materialize",
      ownerNodeId: "subtype-candidate",
      fieldDefinitionId: "field-definition",
      fieldNodeId: "subtype-field",
      fieldOccurrenceId: "subtype-field-occurrence",
    },
    nodeAt("field-only", "field-only-candidate", "field-only-occurrence"),
    {
      kind: "field-materialize",
      ownerNodeId: "field-only-candidate",
      fieldDefinitionId: "field-definition",
      fieldNodeId: "field-only",
      fieldOccurrenceId: "field-only-occurrence",
    },
  ];
  const result = await workspace.execute(command("fixture", "setup", operations));
  if (result.status === "rejected") {
    throw new Error(JSON.stringify(result.error));
  }
  expect(result.status).toBe("published");
}

function nodeAt(
  nodeId: string,
  parentNodeId: string,
  occurrenceId: string,
  nodeType?: "supertag-definition" | "field-definition" | "search",
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

async function searchResults(
  workspace: ProposalWorkspace,
  perspective: "origin" | "review",
): Promise<SearchResultsResult> {
  return workspace.query({
    kind: "search-results",
    workspaceId: "workspace",
    perspective,
    searchNodeId: "search",
  });
}

async function resultNodeIds(
  workspace: ProposalWorkspace,
  perspective: "origin" | "review",
): Promise<readonly string[]> {
  return (await searchResults(workspace, perspective)).results.map((result) => result.targetNodeId);
}

async function searchProjection(workspace: ProposalWorkspace) {
  const [roots, owners, clauses, occurrences] = await Promise.all([
    workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "metanodes",
    }),
    workspace.query({ kind: "projection", workspaceId: "workspace", perspective: "origin", section: "nodeOwners" }),
    workspace.query({ kind: "projection", workspaceId: "workspace", perspective: "origin", section: "searchClauses" }),
    workspace.query({ kind: "projection", workspaceId: "workspace", perspective: "origin", section: "occurrences" }),
  ]);
  if (
    !("metanodes" in roots) ||
    !("nodeOwners" in owners) ||
    !("searchClauses" in clauses) ||
    !("occurrences" in occurrences)
  ) {
    throw new Error("Expected Search Projection sections");
  }
  return {
    metanodes: roots.metanodes,
    nodeOwners: owners.nodeOwners,
    searchClauses: clauses.searchClauses,
    occurrences: occurrences.occurrences,
  };
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}
