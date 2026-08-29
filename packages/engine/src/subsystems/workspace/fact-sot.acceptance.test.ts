import { describe, expect, it } from "vitest";

import type { EditCommand } from "@lode/sdk";
import { syncPair } from "../../../tests/support/sync.js";

import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import { InMemoryDocumentStore } from "../persistence/index.js";
import {
  assertFactOracleEquivalence,
  canonicalPublicDomainState,
} from "../../../tests/support/reconcile/fact-oracle-equivalence.js";
import { FACT_AUTHORITY_DOCUMENT_ID } from "./authority/loro-fact-store.js";
import { FactAuthority } from "./authority/fact-authority.js";
import { FactReplication } from "./fact-replication.js";
import { Workspace } from "./workspace.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("Fact source-of-truth reconstruction", () => {
  it("rebuilds a public Direct, Proposal, Resolution, and History program from Facts alone", async () => {
    const documents = new InMemoryDocumentStore();
    const sourceFacts = await FactAuthority.open({ workspaceId: "workspace", loroPeerId: "101", documents });
    const source = await Workspace.open({ workspaceId: "workspace", facts: sourceFacts, versions });

    await published(
      source.execute({
        kind: "edit",
        workspaceId: "workspace",
        invocationId: "public-structure",
        actorId: "actor",
        intent: "direct",
        historyChannelId: "fact-sot",
        actions: [
          node("root", "workspace", "root-original"),
          node("child", "root", "child-original"),
          node("reference-parent", "workspace", "reference-parent-original"),
          {
            kind: "occurrence-create",
            occurrenceId: "child-reference",
            nodeId: "child",
            parentNodeId: "reference-parent",
            anchor: end,
          },
        ],
      }),
    );
    await published(
      source.execute(
        edit("public-domain-surface", "surface", [
          node("tag", "workspace", "tag-original", "supertag-definition"),
          node("search", "workspace", "search-original", "search"),
          node("candidate", "root", "candidate-original"),
          node("target", "workspace", "target-original"),
          node("trash-me", "workspace", "trash-me-original"),
          node("trash-visible", "workspace", "trash-visible-original"),
          { kind: "rich-text-splice", nodeId: "candidate", deleteAtomIds: [], anchor: end, insert: "Candidate" },
          { kind: "supertag-application-create", hostNodeId: "candidate", supertagId: "tag", anchor: end },
          {
            kind: "inline-reference-create",
            inlineReferenceId: "candidate-target",
            hostNodeId: "candidate",
            targetNodeId: "target",
            anchor: end,
          },
        ]),
      ),
    );
    await published(
      source.execute(
        edit("public-template-field", "surface", [
          {
            kind: "supertag-template-field-create",
            supertagId: "tag",
            fieldDefinitionId: "status-field",
            fieldDefinitionSeed: { text: [{ value: "Status", attributes: {} }] },
            anchor: end,
          },
        ]),
      ),
    );
    await published(
      source.execute(
        edit("public-search", "surface", [
          {
            kind: "search-expression-create",
            searchNodeId: "search",
            expression: { kind: "supertag", supertagId: "tag" },
            anchor: end,
          },
        ]),
      ),
    );
    await published(
      source.execute(
        edit("public-view", "surface", [
          { kind: "shared-default-view-create", hostNodeId: "root", viewType: "outline", anchor: end },
        ]),
      ),
    );
    await published(
      source.execute(
        edit("public-trash", "surface", [
          { kind: "node-delete", nodeId: "trash-me" },
          { kind: "node-delete", nodeId: "trash-visible" },
        ]),
      ),
    );
    await expect(
      source.query({ kind: "supertag-instances", workspaceId: "workspace", perspective: "origin", supertagId: "tag" }),
    ).resolves.toMatchObject({ nodeIds: ["candidate"] });
    await expect(
      source.query({ kind: "search-results", workspaceId: "workspace", perspective: "origin", searchNodeId: "search" }),
    ).resolves.toMatchObject({ available: true, results: [expect.objectContaining({ targetNodeId: "candidate" })] });
    await expect(
      source.query({ kind: "backlinks", workspaceId: "workspace", perspective: "origin", targetNodeId: "target" }),
    ).resolves.toMatchObject({ backlinks: [expect.objectContaining({ hostNodeId: "candidate" })] });
    const viewRows = await source.query({
      kind: "view-rows",
      workspaceId: "workspace",
      perspective: "origin",
      hostNodeId: "root",
    });
    expect(viewRows.available).toBe(true);
    expect(viewRows.rows.some((row) => row.targetNodeId === "candidate")).toBe(true);
    await expect(
      source.query({ kind: "trash-evidence", workspaceId: "workspace", perspective: "origin", nodeId: "trash-me" }),
    ).resolves.toMatchObject({ available: true });
    await expect(
      source.query({
        kind: "trash-evidence",
        workspaceId: "workspace",
        perspective: "origin",
        nodeId: "trash-visible",
      }),
    ).resolves.toMatchObject({ available: true });
    await published(
      source.execute({
        kind: "finalize-deletions",
        workspaceId: "workspace",
        invocationId: "public-finalize-trash",
        actorId: "actor",
        nodeIds: ["trash-me"],
      }),
    );
    await published(
      source.execute({
        kind: "edit",
        workspaceId: "workspace",
        invocationId: "public-proposal",
        actorId: "author",
        intent: "proposal",
        historyChannelId: "fact-sot",
        actions: [
          {
            kind: "rich-text-splice",
            nodeId: "child",
            deleteAtomIds: [],
            anchor: end,
            insert: "accepted proposal",
          },
        ],
      }),
    );
    const review = await source.query({ kind: "review", workspaceId: "workspace", limit: 100 });
    const selection = review.hunks[0]?.selection;
    if (!selection) {
      throw new Error("Public Fact program has no Review selection");
    }
    await published(
      source.execute({
        kind: "resolve-review",
        workspaceId: "workspace",
        invocationId: "public-accept",
        actorId: "reviewer",
        decision: "accept",
        selection,
      }),
    );
    await published(
      source.execute({
        kind: "edit",
        workspaceId: "workspace",
        invocationId: "public-direct-edit",
        actorId: "actor",
        intent: "direct",
        historyChannelId: "fact-sot",
        actions: [
          {
            kind: "rich-text-splice",
            nodeId: "root",
            deleteAtomIds: [],
            anchor: end,
            insert: "undo me",
          },
        ],
      }),
    );
    const history = await source.query({ kind: "history", workspaceId: "workspace", channelId: "fact-sot" });
    if (!history.undo) {
      throw new Error("Public Fact program has no History selection");
    }
    await published(
      source.execute({
        kind: "undo",
        workspaceId: "workspace",
        invocationId: "public-undo",
        actorId: "actor",
        selection: history.undo,
      }),
    );
    const undoneHistory = await source.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "fact-sot",
    });
    if (!undoneHistory.redo) {
      throw new Error("Public Fact program has no Redo selection");
    }
    await published(
      source.execute({
        kind: "redo",
        workspaceId: "workspace",
        invocationId: "public-redo",
        actorId: "actor",
        selection: undoneHistory.redo,
      }),
    );

    const authoritative = sourceFacts.snapshot();
    assertFactOracleEquivalence(authoritative.facts, 808);
    const historyChannels = ["fact-sot", "surface"];
    const queryNodeIds = [
      "root",
      "child",
      "reference-parent",
      "candidate",
      "target",
      "trash-me",
      "trash-visible",
      "tag",
      "search",
    ];
    const expected = await canonicalPublicDomainState(source, 1, historyChannels, queryNodeIds);
    const update = await sourceFacts.replication.exportUpdate();
    await source.close();

    for (const id of await documents.listIds()) {
      if (id !== FACT_AUTHORITY_DOCUMENT_ID) {
        await documents.delete(id);
      }
    }
    const restartedFacts = await FactAuthority.open({ workspaceId: "workspace", loroPeerId: "101", documents });
    const restarted = await Workspace.open({ workspaceId: "workspace", facts: restartedFacts, versions });
    expect(await canonicalPublicDomainState(restarted, 2, historyChannels, queryNodeIds)).toBe(expected);
    await expect(
      restarted.query({ kind: "invocation", workspaceId: "workspace", invocationId: "public-redo" }),
    ).resolves.toEqual({ status: "absent" });

    const replicaDocuments = new InMemoryDocumentStore();
    const replicaFacts = await FactAuthority.open({
      workspaceId: "workspace",
      loroPeerId: "202",
      documents: replicaDocuments,
    });
    await replicaFacts.replication.importUpdate(update);
    const replica = await Workspace.open({
      workspaceId: "workspace",
      facts: replicaFacts,
      versions,
      seedGenesis: false,
    });
    expect(await canonicalPublicDomainState(replica, 3, historyChannels, queryNodeIds)).toBe(expected);
    await Promise.all([restarted.close(), replica.close()]);
  });

  it("rebuilds concurrent Resolution conflict and adjudication from Facts alone", async () => {
    const leftFacts = await FactAuthority.open({
      workspaceId: "workspace",
      loroPeerId: "301",
      documents: new InMemoryDocumentStore(),
    });
    const left = await Workspace.open({ workspaceId: "workspace", facts: leftFacts, versions });
    await published(
      left.execute({
        ...edit("conflicting-proposal", "conflict", [node("conflicted-node", "workspace", "conflicted-original")]),
        actorId: "author",
        intent: "proposal",
      }),
    );

    const rightFacts = await FactAuthority.open({
      workspaceId: "workspace",
      loroPeerId: "302",
      documents: new InMemoryDocumentStore(),
    });
    const right = await Workspace.open({ workspaceId: "workspace", facts: rightFacts, versions, seedGenesis: false });
    await syncPair(new FactReplication(leftFacts.replication), new FactReplication(rightFacts.replication));
    await right.reconcileAuthorityAdvance();

    const leftReview = await left.query({ kind: "review", workspaceId: "workspace" });
    const rightReview = await right.query({ kind: "review", workspaceId: "workspace" });
    const leftSelection = leftReview.hunks[0]?.selection;
    const rightSelection = rightReview.hunks[0]?.selection;
    if (!leftSelection || !rightSelection) {
      throw new Error("Concurrent public Fact program has no Review selection");
    }
    await published(
      left.execute({
        kind: "resolve-review",
        workspaceId: "workspace",
        invocationId: "concurrent-accept",
        actorId: "accept-reviewer",
        decision: "accept",
        selection: leftSelection,
      }),
    );
    await published(
      right.execute({
        kind: "resolve-review",
        workspaceId: "workspace",
        invocationId: "concurrent-reject",
        actorId: "reject-reviewer",
        decision: "reject",
        selection: rightSelection,
      }),
    );
    await syncPair(new FactReplication(rightFacts.replication), new FactReplication(leftFacts.replication));
    await left.reconcileAuthorityAdvance();

    const conflictResult = await left.query({ kind: "conflicts", workspaceId: "workspace" });
    const conflict = conflictResult.issues[0];
    if (conflict?.kind !== "resolution-conflict") {
      throw new Error("Fact-only public program has no Resolution conflict");
    }
    expect(conflict.candidates.map((candidate) => candidate.decision).sort()).toEqual(["accept", "reject"]);
    assertFactOracleEquivalence(leftFacts.snapshot().facts, 909);

    const expectedConflict = await canonicalPublicDomainState(left, 1, ["conflict"], ["conflicted-node"]);
    const freshFacts = await FactAuthority.open({
      workspaceId: "workspace",
      loroPeerId: "303",
      documents: new InMemoryDocumentStore(),
    });
    await freshFacts.replication.importUpdate(await leftFacts.replication.exportUpdate());
    const fresh = await Workspace.open({ workspaceId: "workspace", facts: freshFacts, versions, seedGenesis: false });
    expect(await canonicalPublicDomainState(fresh, 2, ["conflict"], ["conflicted-node"])).toBe(expectedConflict);
    expect(freshFacts.receipts()).toEqual([]);

    await published(
      left.execute({
        kind: "adjudicate-resolution",
        workspaceId: "workspace",
        invocationId: "adjudicate-conflict",
        actorId: "adjudicator",
        decision: "accept",
        proposalFactIds: conflict.proposalFactIds,
        resolutionIds: conflict.candidates.map((candidate) => candidate.resolutionId),
      }),
    );
    await expect(left.query({ kind: "conflicts", workspaceId: "workspace" })).resolves.toMatchObject({ issues: [] });
    assertFactOracleEquivalence(leftFacts.snapshot().facts, 910);
    await Promise.all([left.close(), right.close(), fresh.close()]);
  });
});

function node(
  nodeId: string,
  parentNodeId: string,
  occurrenceId: string,
  intrinsicNodeType?: "supertag-definition" | "search",
): EditCommand["actions"][number] {
  return {
    kind: "node-create",
    nodeId,
    parentNodeId,
    occurrenceId,
    anchor: end,
    ...(intrinsicNodeType === undefined ? {} : { intrinsicNodeType }),
  };
}

function edit(invocationId: string, historyChannelId: string, actions: EditCommand["actions"]): EditCommand {
  return {
    kind: "edit",
    workspaceId: "workspace",
    invocationId,
    actorId: "actor",
    intent: "direct",
    historyChannelId,
    actions,
  };
}

async function published(result: Promise<Readonly<{ status: string }>>): Promise<void> {
  expect(await result).toMatchObject({ status: "published" });
}
