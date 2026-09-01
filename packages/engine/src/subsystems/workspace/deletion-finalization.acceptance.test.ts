import {
  openTestWorkspace,
  type TestWorkspace as Workspace,
} from "../../../tests/support/workspace/open-test-workspace.js";
import type { EditCommand } from "@lode/sdk";
import { describe, expect, it } from "vitest";

import { InMemoryDocumentStore } from "../../../tests/support/document-store.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import { FactAuthority } from "./authority/fact-authority.js";
import { syncPair, testFactReplication } from "../../../tests/support/sync.js";
import { END_SEQUENCE_ANCHOR as end } from "../../domain/fact/index.js";
import { nodeAt } from "../../../tests/support/workspace/edit-test-actions.js";

describe("Deletion Finalization", () => {
  it("records one explicit terminal Action Fact for a Trash root and its owned descendants", async () => {
    const documents = new InMemoryDocumentStore();
    const opened = await open(documents);
    await expectPublished(
      opened.workspace.execute(
        edit("setup", [
          nodeAt("parent", "workspace"),
          nodeAt("child", "parent"),
          nodeAt("shared", "workspace"),
          {
            kind: "occurrence-create",
            occurrenceId: "shared-under-parent",
            nodeId: "shared",
            parentNodeId: "parent",
            anchor: end,
          },
        ]),
      ),
    );
    await expectPublished(opened.workspace.execute(edit("trash-parent", [{ kind: "node-delete", nodeId: "parent" }])));

    const finalized = await opened.workspace.execute({
      kind: "finalize-deletions",
      workspaceId: "workspace",
      invocationId: "finalize-parent",
      actorId: "actor",
      nodeIds: ["parent"],
    });
    expect(finalized).toMatchObject({ status: "published", receipt: { lineage: null } });
    if (finalized.status !== "published" || finalized.receipt.factIds[0] === undefined) {
      throw new Error(`Expected published Deletion Finalization: ${JSON.stringify(finalized)}`);
    }
    expect(opened.facts.facts([finalized.receipt.factIds[0]])[0]?.body).toEqual({
      kind: "action",
      actorId: "actor",
      intent: "direct",
      actions: [
        { kind: "node-deletion-finalize", nodeId: "child" },
        { kind: "node-deletion-finalize", nodeId: "parent" },
      ],
    });

    const projection = await nodes(opened.workspace);
    expect(projection).not.toHaveProperty("parent");
    expect(projection).not.toHaveProperty("child");
    expect(projection).toHaveProperty("shared");
    await opened.workspace.close();

    const restarted = await open(documents);
    expect(await nodes(restarted.workspace)).not.toHaveProperty("parent");
    expect(await nodes(restarted.workspace)).toHaveProperty("shared");
  });

  it("preserves an incoming Inline Reference and removes finalized Proposals from Review", async () => {
    const opened = await open(new InMemoryDocumentStore());
    await expectPublished(
      opened.workspace.execute(
        edit("setup-reference", [
          nodeAt("host", "workspace"),
          nodeAt("target", "workspace"),
          {
            kind: "inline-reference-create",
            inlineReferenceId: "reference",
            hostNodeId: "host",
            targetNodeId: "target",
            anchor: end,
          },
        ]),
      ),
    );
    await expectPublished(
      opened.workspace.execute(
        edit(
          "proposal",
          [{ kind: "rich-text-splice", nodeId: "target", deleteAtomIds: [], anchor: end, insert: "proposal" }],
          "proposal",
        ),
      ),
    );
    await expectPublished(opened.workspace.execute(edit("trash-target", [{ kind: "node-delete", nodeId: "target" }])));
    await expectPublished(
      opened.workspace.execute({
        kind: "finalize-deletions",
        workspaceId: "workspace",
        invocationId: "finalize-target",
        actorId: "actor",
        nodeIds: ["target"],
      }),
    );

    expect((await nodes(opened.workspace)).host?.content).toMatchObject([
      {
        kind: "inline-reference",
        id: "reference",
        targetNodeId: "target",
        targetStatus: "unavailable",
      },
    ]);
    const review = await opened.workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in review)) {
      throw new Error("Expected Review query");
    }
    expect(review.hunks).toEqual([]);
  });

  it("rejects a root that is not currently in Trash", async () => {
    const opened = await open(new InMemoryDocumentStore());
    await expectPublished(opened.workspace.execute(edit("setup-active", [nodeAt("active", "workspace")])));
    expect(
      await opened.workspace.execute({
        kind: "finalize-deletions",
        workspaceId: "workspace",
        invocationId: "finalize-active",
        actorId: "actor",
        nodeIds: ["active"],
      }),
    ).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });
  });

  it("suppresses a concurrent Restore and later edits without finalizing unrelated Trash Nodes", async () => {
    const primary = await open(new InMemoryDocumentStore(), "101");
    await expectPublished(
      primary.workspace.execute(
        edit("setup-concurrency", [nodeAt("target", "workspace"), nodeAt("later", "workspace")]),
      ),
    );
    await expectPublished(primary.workspace.execute(edit("trash-target", [{ kind: "node-delete", nodeId: "target" }])));

    const offline = await open(new InMemoryDocumentStore(), "202", false);
    await sync(primary, offline);
    await expectPublished(
      primary.workspace.execute({
        kind: "finalize-deletions",
        workspaceId: "workspace",
        invocationId: "finalize-concurrent-target",
        actorId: "actor",
        nodeIds: ["target"],
      }),
    );
    await expectPublished(
      offline.workspace.execute(
        edit("offline-restore-and-edit", [
          {
            kind: "node-restore",
            nodeId: "target",
            occurrenceId: "target-original",
            parentNodeId: "workspace",
            anchor: end,
          },
          { kind: "rich-text-splice", nodeId: "target", deleteAtomIds: [], anchor: end, insert: "offline" },
        ]),
      ),
    );
    await expectPublished(primary.workspace.execute(edit("trash-later", [{ kind: "node-delete", nodeId: "later" }])));

    await sync(offline, primary);
    const projection = await nodes(primary.workspace);
    expect(projection).not.toHaveProperty("target");
    expect(projection).toHaveProperty("later");
  });
});

async function open(documents: InMemoryDocumentStore, loroPeerId: `${number}` = "101", seedGenesis = true) {
  const facts = await FactAuthority.open({ workspaceId: "workspace", loroPeerId, documents });
  return { facts, workspace: await openTestWorkspace({ workspaceId: "workspace", facts, versions, seedGenesis }) };
}

async function sync(left: Awaited<ReturnType<typeof open>>, right: Awaited<ReturnType<typeof open>>): Promise<void> {
  await syncPair(testFactReplication(left.facts.replication), testFactReplication(right.facts.replication));
  await left.workspace.reconcileAuthorityAdvance();
  await right.workspace.reconcileAuthorityAdvance();
}

function edit(
  invocationId: string,
  actions: EditCommand["actions"],
  intent: EditCommand["intent"] = "direct",
): EditCommand {
  return {
    kind: "edit",
    workspaceId: "workspace",
    invocationId,
    actorId: "actor",
    intent,
    historyChannelId: "deletion-finalization",
    actions,
  };
}

async function expectPublished(result: Promise<unknown>): Promise<void> {
  expect(await result).toMatchObject({ status: "published" });
}

async function nodes(workspace: Workspace) {
  const result = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective: "origin",
    section: "nodes",
  });
  if (!("nodes" in result)) {
    throw new Error("Expected Node Projection");
  }
  return result.nodes;
}
