import {
  openTestWorkspace,
  type TestWorkspace as Workspace,
} from "../../../tests/support/workspace/open-test-workspace.js";
import { describe, expect, it } from "vitest";

import type {
  EditCommand,
  ProjectedInlineReference,
  ProjectedNode,
  ProjectedOccurrence,
  ProjectionPage,
} from "@lode/sdk";
import { InMemoryDocumentStore } from "../../../tests/support/document-store.js";
import { FactAuthority } from "./authority/fact-authority.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import { END_SEQUENCE_ANCHOR as end } from "../../domain/fact/index.js";
import { nodeAt } from "../../../tests/support/workspace/edit-test-actions.js";

describe("Inline Reference product model", () => {
  it("restores text on both sides of a reference when undoing one sparse splice", async () => {
    const workspace = await setup();
    await createHostAndTarget(workspace);
    const [a, b] = textAtomIds((await nodes(workspace, "origin")).nodes.host?.content ?? []);
    expect(
      (
        await workspace.execute(
          command("middle-reference", "setup", [
            {
              kind: "inline-reference-create",
              inlineReferenceId: "middle",
              hostNodeId: "host",
              targetNodeId: "target",
              anchor: { ...end, after: a, before: b },
            },
          ]),
        )
      ).status,
    ).toBe("published");
    const ids = required((await nodes(workspace, "origin")).nodes.host, "host").content.flatMap((item) =>
      item.kind === "text" ? [item.id] : [],
    );
    expect(
      (
        await workspace.execute(
          command("sparse-splice", "sparse", [
            { kind: "rich-text-splice", nodeId: "host", deleteAtomIds: ids, anchor: end, insert: "replacement" },
          ]),
        )
      ).status,
    ).toBe("published");
    const history = await workspace.query({ kind: "history", workspaceId: "workspace", channelId: "sparse" });
    if (!("undo" in history) || history.undo === null) {
      throw new Error("Expected an undo selection");
    }
    expect(
      (
        await workspace.execute({
          kind: "undo",
          workspaceId: "workspace",
          actorId: "actor",
          invocationId: "undo-sparse",
          selection: history.undo,
        })
      ).status,
    ).toBe("published");
    expect(
      required((await nodes(workspace, "origin")).nodes.host, "host")
        .content.map((item) => (item.kind === "text" ? item.value : item.id))
        .join("|"),
    ).toBe("A|middle|B");
  });
  it("anchors text before and after a reference while rejecting a reference from another node", async () => {
    const workspace = await setup();
    await createHostAndTarget(workspace);
    expect(
      (
        await workspace.execute(
          command("reference-anchor", "edit", [
            {
              kind: "inline-reference-create",
              inlineReferenceId: "anchor-reference",
              hostNodeId: "host",
              targetNodeId: "target",
              anchor: end,
            },
          ]),
        )
      ).status,
    ).toBe("published");
    expect(
      (
        await workspace.execute(
          command("text-at-reference", "edit", [
            {
              kind: "rich-text-splice",
              nodeId: "host",
              deleteAtomIds: [],
              insert: " before",
              anchor: { ...end, before: "anchor-reference" },
            },
            {
              kind: "rich-text-splice",
              nodeId: "host",
              deleteAtomIds: [],
              insert: " after",
              anchor: { ...end, after: "anchor-reference" },
            },
          ]),
        )
      ).status,
    ).toBe("published");
    const content = (await nodes(workspace, "origin")).nodes.host?.content;
    expect(content?.map((item) => (item.kind === "text" ? item.value : "@")).join("")).toBe("AB before@ after");
    expect(
      (
        await workspace.execute(
          command("foreign-reference-anchor", "edit", [
            {
              kind: "rich-text-splice",
              nodeId: "target",
              deleteAtomIds: [],
              insert: "invalid",
              anchor: { ...end, before: "anchor-reference" },
            },
          ]),
        )
      ).status,
    ).toBe("rejected");
  });
  it("INLINE-1 keeps one ordered identity and an owned Alias through public Undo and Redo", async () => {
    const workspace = await setup();
    await createHostAndTarget(workspace);
    const host = await nodes(workspace, "origin");
    const [a, b] = textAtomIds(host.nodes.host?.content ?? []);

    expect(
      (
        await workspace.execute(
          command("create-inline", "inline", [
            {
              kind: "inline-reference-create",
              inlineReferenceId: "inline-1",
              hostNodeId: "host",
              targetNodeId: "target",
              anchor: { after: a, before: b, affinity: "after", fallback: "end" },
            },
          ]),
        )
      ).status,
    ).toBe("published");
    const targetAtoms = (await nodes(workspace, "origin")).nodes.target?.content
      .filter((item) => item.kind === "text")
      .map((item) => item.id);
    expect(
      (
        await workspace.execute(
          command("rename-target", "target", [
            {
              kind: "rich-text-splice",
              nodeId: "target",
              deleteAtomIds: targetAtoms ?? [],
              anchor: end,
              insert: "Renamed",
            },
          ]),
        )
      ).status,
    ).toBe("published");
    const renamed = await nodes(workspace, "origin");
    expect(textValue(renamed.nodes.target?.content ?? [])).toBe("Renamed");
    expect(inlineReference(await projection(workspace, "origin"), "host", "inline-1").targetNodeId).toBe("target");
    const aliasCreation = await workspace.execute(
      command("create-alias", "alias", [
        {
          kind: "inline-reference-alias-create",
          inlineReferenceId: "inline-1",
          hostNodeId: "host",
          aliasNodeId: "alias",
          seed: { text: [..."Alias"].map((value) => ({ value, attributes: {} })) },
        },
      ]),
    );
    expect("error" in aliasCreation ? aliasCreation.error : undefined).toBeUndefined();
    expect(aliasCreation).toMatchObject({ status: "published" });

    const attached = await projection(workspace, "origin");
    expect(attached.nodes.host?.content).toMatchObject([
      { kind: "text", value: "A" },
      {
        kind: "inline-reference",
        id: "inline-1",
        targetNodeId: "target",
        aliasNodeId: "alias",
        targetStatus: "active",
      },
      { kind: "text", value: "B" },
    ]);
    expect(attached.metanodes).toEqual({});
    expect(attached.nodeOwners.alias).toBe("host");
    expect(Object.values(attached.occurrences).some((occurrence) => occurrence.nodeId === "alias")).toBe(false);

    const history = await workspace.query({ kind: "history", workspaceId: "workspace", channelId: "alias" });
    if (!("undo" in history) || !history.undo) {
      throw new Error("Expected Inline Alias Undo");
    }
    const undoResult = await workspace.execute({
      kind: "undo",
      workspaceId: "workspace",
      invocationId: "undo-alias",
      actorId: "actor",
      selection: history.undo,
    });
    if (undoResult.status === "rejected") {
      throw new Error(JSON.stringify(undoResult.error));
    }
    expect(undoResult.status).toBe("published");
    const undone = await projection(workspace, "origin");
    expect(inlineReference(undone, "host", "inline-1").aliasNodeId).toBeNull();
    expect(undone.metanodes).toEqual({});

    const redo = await workspace.query({ kind: "history", workspaceId: "workspace", channelId: "alias" });
    if (!("redo" in redo) || !redo.redo) {
      throw new Error("Expected Inline Alias Redo");
    }
    const redoResult = await workspace.execute({
      kind: "redo",
      workspaceId: "workspace",
      invocationId: "redo-alias",
      actorId: "actor",
      selection: redo.redo,
    });
    expect(redoResult.status).toBe("published");
    expect(inlineReference(await projection(workspace, "origin"), "host", "inline-1").aliasNodeId).toBe("alias");

    const detachedAlias = await workspace.execute(
      command("detach-alias", "alias-attachment", [
        { kind: "inline-alias-detach", inlineReferenceId: "inline-1", aliasNodeId: "alias" },
      ]),
    );
    expect(detachedAlias, JSON.stringify(detachedAlias)).toMatchObject({ status: "published" });
    expect(inlineReference(await projection(workspace, "origin"), "host", "inline-1").aliasNodeId).toBeNull();
    expect(
      (
        await workspace.execute(
          command("attach-alias", "alias-attachment", [
            { kind: "inline-alias-attach", inlineReferenceId: "inline-1", aliasNodeId: "alias" },
          ]),
        )
      ).status,
    ).toBe("published");
    expect(inlineReference(await projection(workspace, "origin"), "host", "inline-1").aliasNodeId).toBe("alias");
  });

  it("INLINE-2 derives target availability from Trash ownership and preserves the reference on restore", async () => {
    const workspace = await setup();
    await createHostAndTarget(workspace);
    await workspace.execute(
      command("create-inline", "inline", [
        {
          kind: "inline-reference-create",
          inlineReferenceId: "inline-1",
          hostNodeId: "host",
          targetNodeId: "target",
          anchor: end,
        },
      ]),
    );
    const deletion = await workspace.execute(
      command("trash-target", "target", [{ kind: "node-delete", nodeId: "target" }]),
    );
    if (deletion.status !== "published") {
      throw new Error(`Expected target deletion to publish: ${JSON.stringify(deletion)}`);
    }
    expect(inlineReference(await projection(workspace, "origin"), "host", "inline-1")).toMatchObject({
      targetNodeId: "target",
      targetStatus: "trash",
    });

    expect(
      (
        await workspace.execute(
          command("restore-target", "target", [
            {
              kind: "node-restore",
              nodeId: "target",
              occurrenceId: "target-original",
              parentNodeId: "workspace",
              anchor: end,
            },
          ]),
        )
      ).status,
    ).toBe("published");
    expect(inlineReference(await projection(workspace, "origin"), "host", "inline-1")).toMatchObject({
      id: "inline-1",
      targetNodeId: "target",
      targetStatus: "active",
    });
  });

  it("INLINE-3 derives block and inline Backlinks independently for Origin and Review", async () => {
    const workspace = await setup();
    await createHostAndTarget(workspace);
    await workspace.execute(
      command("block-reference", "setup", [
        nodeAt("reference-parent", "workspace", "reference-parent-original"),
        {
          kind: "occurrence-create",
          occurrenceId: "target-reference",
          nodeId: "target",
          parentNodeId: "reference-parent",
          anchor: end,
        },
      ]),
    );
    await workspace.execute(
      command(
        "propose-inline",
        "inline",
        [
          {
            kind: "inline-reference-create",
            inlineReferenceId: "inline-proposal",
            hostNodeId: "host",
            targetNodeId: "target",
            anchor: end,
          },
        ],
        "proposal",
      ),
    );

    const origin = await workspace.query({
      kind: "backlinks",
      workspaceId: "workspace",
      perspective: "origin",
      targetNodeId: "target",
    });
    const review = await workspace.query({
      kind: "backlinks",
      workspaceId: "workspace",
      perspective: "review",
      targetNodeId: "target",
    });
    expect(origin.backlinks).toEqual([
      {
        sourceKind: "block",
        sourceIdentity: "target-reference",
        hostNodeId: "reference-parent",
        targetStatus: "active",
      },
    ]);
    expect(review.backlinks).toEqual([
      {
        sourceKind: "block",
        sourceIdentity: "target-reference",
        hostNodeId: "reference-parent",
        targetStatus: "active",
      },
      { sourceKind: "inline", sourceIdentity: "inline-proposal", hostNodeId: "host", targetStatus: "active" },
    ]);

    const reviewQueue = await workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in reviewQueue) || !reviewQueue.hunks[0]) {
      throw new Error("Expected Inline Reference Review Hunk");
    }
    expect(reviewQueue.hunks).toHaveLength(1);
    expect(reviewQueue.hunks[0].diffSpace).toEqual({ kind: "inline-reference", identity: "inline-proposal" });
    expect(
      (
        await workspace.execute({
          kind: "resolve-review",
          workspaceId: "workspace",
          invocationId: "accept-inline",
          actorId: "reviewer",
          decision: "accept",
          selection: reviewQueue.hunks[0].selection,
        })
      ).status,
    ).toBe("published");
    const accepted = await workspace.query({
      kind: "backlinks",
      workspaceId: "workspace",
      perspective: "origin",
      targetNodeId: "target",
    });
    expect(accepted.backlinks.map((backlink) => backlink.sourceIdentity)).toEqual([
      "target-reference",
      "inline-proposal",
    ]);
  });
});

async function setup(): Promise<Workspace> {
  const facts = await FactAuthority.open({
    workspaceId: "workspace",
    loroPeerId: "101",
    documents: new InMemoryDocumentStore(),
  });
  return openTestWorkspace({ workspaceId: "workspace", facts, versions });
}

async function createHostAndTarget(workspace: Workspace): Promise<void> {
  const result = await workspace.execute(
    command("host-and-target", "setup", [
      nodeAt("host", "workspace", "host-original"),
      nodeAt("target", "workspace", "target-original"),
      { kind: "rich-text-splice", nodeId: "host", deleteAtomIds: [], anchor: end, insert: "AB" },
      { kind: "rich-text-splice", nodeId: "target", deleteAtomIds: [], anchor: end, insert: "Target" },
    ]),
  );
  expect(result.status).toBe("published");
}

function command(
  invocationId: string,
  historyChannelId: string,
  actions: EditCommand["actions"],
  intent: EditCommand["intent"] = "direct",
): EditCommand {
  return {
    kind: "edit",
    workspaceId: "workspace",
    invocationId,
    actorId: "actor",
    intent,
    historyChannelId,
    actions,
  };
}

async function nodes(workspace: Workspace, perspective: "origin" | "review"): Promise<ProjectionPage<"nodes">> {
  const page = await workspace.query({ kind: "projection", workspaceId: "workspace", perspective, section: "nodes" });
  if (!("nodes" in page)) {
    throw new Error("Expected Node Projection page");
  }
  return page;
}

async function projection(workspace: Workspace, perspective: "origin" | "review"): Promise<InlineProjection> {
  const [nodePage, rootPage, ownerPage, occurrencePage] = await Promise.all([
    nodes(workspace, perspective),
    workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective,
      section: "metanodes",
    }),
    workspace.query({ kind: "projection", workspaceId: "workspace", perspective, section: "nodeOwners" }),
    workspace.query({ kind: "projection", workspaceId: "workspace", perspective, section: "occurrences" }),
  ]);
  if (!("metanodes" in rootPage) || !("nodeOwners" in ownerPage) || !("occurrences" in occurrencePage)) {
    throw new Error("Expected Inline Reference Projection sections");
  }
  return {
    nodes: nodePage.nodes,
    metanodes: rootPage.metanodes,
    nodeOwners: ownerPage.nodeOwners,
    occurrences: occurrencePage.occurrences,
  };
}

function textAtomIds(content: ProjectedNode["content"]): readonly [string, string] {
  const ids = content.flatMap((item) => (item.kind === "text" ? [item.id] : []));
  return [required(ids[0], "first text atom"), required(ids[1], "second text atom")];
}

function textValue(content: ProjectedNode["content"]): string {
  return content.flatMap((item) => (item.kind === "text" ? [item.value] : [])).join("");
}

function inlineReference(
  projectionPage: InlineProjection,
  hostNodeId: string,
  inlineReferenceId: string,
): ProjectedInlineReference {
  const item = projectionPage.nodes[hostNodeId]?.content.find(
    (candidate) => candidate.kind === "inline-reference" && candidate.id === inlineReferenceId,
  );
  if (item?.kind !== "inline-reference") {
    throw new Error(`Missing Inline Reference ${inlineReferenceId}`);
  }
  return item;
}

type InlineProjection = Readonly<{
  nodes: Readonly<Record<string, ProjectedNode>>;
  metanodes: Readonly<Record<string, string>>;
  nodeOwners: Readonly<Record<string, string | null>>;
  occurrences: Readonly<Record<string, ProjectedOccurrence>>;
}>;

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}
