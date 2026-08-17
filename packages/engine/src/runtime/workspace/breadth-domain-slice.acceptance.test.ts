import { describe, expect, it } from "vitest";

import type { MutationCommand } from "@lode/sdk";
import { admitAuthorityRecords } from "../../domain/admission/index.js";
import { InMemoryDocumentStore } from "../../persistence/in-memory-document-store.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import { createReplicaId, FactAuthorityStore } from "../authority/fact-authority-store.js";
import { ProposalWorkspace } from "./proposal-workspace.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("breadth-first domain slice", () => {
  it("BREADTH-1 exposes Debug node, Outline, URL Node, Code Node, and Field Value as formal capabilities", async () => {
    const workspace = await setup();
    await publish(
      workspace,
      command("fixture", [
        nodeAt("debug-target", "workspace", "debug-target-occ", "Debug target"),
        nodeAt("code-target", "workspace", "code-target-occ", "const answer = 42;"),
        nodeAt("field-host", "workspace", "field-host-occ", "Field host"),
        nodeAt("field-definition", "workspace", "field-definition-occ", "Field", "field-definition"),
        nodeAt("outline-root", "workspace", "outline-root-occ", "Outline root"),
        nodeAt("outline-b", "outline-root", "outline-b-occ", "B"),
        nodeAt("outline-a", "outline-root", "outline-a-occ", "A"),
        nodeAt("outline-grandchild", "outline-b", "outline-grandchild-occ", "Grandchild"),
      ]),
    );

    await publish(
      workspace,
      command("debug-open", [{ kind: "debug-node-open", hostNodeId: "debug-target", metanodeId: "debug-meta" }]),
    );
    expect(await debugNode(workspace, "debug-target")).toMatchObject({
      available: true,
      metanodeId: "debug-meta",
      metanodeChildOccurrenceIds: [],
    });
    expect(
      await workspace.execute(
        command("debug-open-again", [
          { kind: "debug-node-open", hostNodeId: "debug-target", metanodeId: "debug-meta" },
        ]),
      ),
    ).toMatchObject({ status: "rejected" });

    await publish(
      workspace,
      command("url-create", [
        {
          kind: "url-node-create",
          nodeId: "url-node",
          occurrenceId: "url-node-occ",
          parentNodeId: "workspace",
          anchor: end,
          seed: textSeed("Lode URL"),
          urlFieldNodeId: "url-field",
          urlFieldOccurrenceId: "url-field-occ",
          urlValueNodeId: "url-value",
          urlValueOccurrenceId: "url-value-occ",
          url: "https://example.com/lode",
        },
      ]),
    );
    expect(await debugNode(workspace, "url-node")).toMatchObject({
      available: true,
      url: "https://example.com/lode",
      codeLanguage: null,
    });

    await publish(
      workspace,
      command("code-configure", [
        {
          kind: "code-node-configure",
          nodeId: "code-target",
          languageFieldNodeId: "code-language-field",
          languageFieldOccurrenceId: "code-language-field-occ",
          languageValueNodeId: "code-language-value",
          languageValueOccurrenceId: "code-language-value-occ",
          language: "JavaScript",
        },
      ]),
    );
    expect(await debugNode(workspace, "code-target")).toMatchObject({
      available: true,
      codeLanguage: "JavaScript",
      url: null,
    });

    await publish(
      workspace,
      command("field-values", [
        {
          kind: "field-value-create",
          ownerNodeId: "field-host",
          fieldDefinitionId: "field-definition",
          fieldNodeId: "field",
          fieldOccurrenceId: "field-occ",
          valueNodeId: "field-value-a",
          valueOccurrenceId: "field-value-a-occ",
          anchor: end,
          seed: textSeed("Alpha"),
        },
        {
          kind: "field-value-create",
          ownerNodeId: "field-host",
          fieldDefinitionId: "field-definition",
          fieldNodeId: "field",
          fieldOccurrenceId: "field-occ",
          valueNodeId: "field-value-b",
          valueOccurrenceId: "field-value-b-occ",
          anchor: end,
          seed: textSeed("Beta"),
        },
      ]),
    );
    expect((await debugNode(workspace, "field-host")).materializedFields).toEqual([
      expect.objectContaining({
        fieldDefinitionId: "field-definition",
        fieldNodeId: "field",
        valueOccurrenceIds: ["field-value-a-occ", "field-value-b-occ"],
      }),
    ]);

    const firstPage = await workspace.query({
      kind: "outline",
      workspaceId: "workspace",
      perspective: "origin",
      rootNodeId: "outline-root",
      maxDepth: 2,
      limit: 2,
    });
    expect(firstPage.rows.map((row) => [row.nodeId, row.depth])).toEqual([
      ["outline-b", 1],
      ["outline-grandchild", 2],
    ]);
    const secondPage = await workspace.query({
      kind: "outline",
      workspaceId: "workspace",
      perspective: "origin",
      rootNodeId: "outline-root",
      maxDepth: 2,
      after: required(firstPage.next, "Outline cursor"),
      limit: 2,
    });
    expect(secondPage.rows.map((row) => [row.nodeId, row.depth])).toEqual([["outline-a", 1]]);
  });

  it("BREADTH-2 creates the evidenced View Sort graph and persists the corresponding outline reorder", async () => {
    const workspace = await setup();
    await publish(
      workspace,
      command("view-fixture", [
        nodeAt("host", "workspace", "host-occ", "Host"),
        nodeAt("z-child", "host", "z-child-occ", "z"),
        nodeAt("a-child", "host", "a-child-occ", "A"),
      ]),
    );
    await publish(
      workspace,
      command("view-create", [
        {
          kind: "shared-default-view-definition-create",
          hostNodeId: "host",
          metanodeId: "host-meta",
          attachmentNodeId: "view-attachment",
          attachmentOccurrenceId: "view-attachment-occ",
          relationDefinitionOccurrenceId: "view-attachment-definition-occ",
          viewDefinitionNodeId: "view-definition",
          viewDefinitionOccurrenceId: "view-definition-occ",
          viewType: "outline",
          anchor: end,
        },
      ]),
    );
    await publish(
      workspace,
      command("view-sort", [
        {
          kind: "shared-default-view-definition-sort-by-name-create",
          hostNodeId: "host",
          viewDefinitionNodeId: "view-definition",
          sortOrderFieldNodeId: "sort-order",
          sortOrderFieldOccurrenceId: "sort-order-occ",
          sortFieldNodeId: "sort-field",
          sortFieldOccurrenceId: "sort-field-occ",
          nodeNameOccurrenceId: "sort-node-name-occ",
          ascendingOccurrenceId: "sort-ascending-occ",
        },
      ]),
    );

    const definitions = await workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "sharedDefaultViewDefinitions",
    });
    if (!("sharedDefaultViewDefinitions" in definitions)) {
      throw new Error("Expected View Definition Projection");
    }
    expect(definitions.sharedDefaultViewDefinitions.host?.[0]?.sortByNameAscending).toMatchObject({
      sortOrderFieldNodeId: "sort-order",
      sortFieldNodeId: "sort-field",
      nodeNameOccurrenceId: "sort-node-name-occ",
      ascendingOccurrenceId: "sort-ascending-occ",
    });
    const view = await workspace.query({
      kind: "view-rows",
      workspaceId: "workspace",
      perspective: "origin",
      hostNodeId: "host",
    });
    expect(view.rows.map((row) => row.targetNodeId)).toEqual(["a-child", "z-child"]);
    const outline = await workspace.query({
      kind: "outline",
      workspaceId: "workspace",
      perspective: "origin",
      rootNodeId: "host",
      maxDepth: 1,
    });
    expect(outline.rows.map((row) => row.nodeId)).toEqual(["a-child", "z-child"]);

    const history = await workspace.query({ kind: "history", workspaceId: "workspace", channelId: "breadth" });
    if (!("undo" in history) || !history.undo) {
      throw new Error("Expected View Sort Undo");
    }
    const undone = await workspace.execute({
      kind: "undo",
      workspaceId: "workspace",
      invocationId: "undo-view-sort",
      actorId: "actor",
      selection: history.undo,
    });
    expect(undone, JSON.stringify(undone)).toMatchObject({ status: "published" });
    const definitionsAfterUndo = await workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "sharedDefaultViewDefinitions",
    });
    if (!("sharedDefaultViewDefinitions" in definitionsAfterUndo)) {
      throw new Error("Expected View Definition Projection after Undo");
    }
    expect(definitionsAfterUndo.sharedDefaultViewDefinitions.host?.[0]?.sortByNameAscending).toBeNull();
    expect(
      (
        await workspace.query({
          kind: "outline",
          workspaceId: "workspace",
          perspective: "origin",
          rootNodeId: "host",
          maxDepth: 1,
        })
      ).rows.map((row) => row.nodeId),
    ).toEqual(["z-child", "a-child"]);

    const redo = await workspace.query({ kind: "history", workspaceId: "workspace", channelId: "breadth" });
    if (!("redo" in redo) || !redo.redo) {
      throw new Error("Expected View Sort Redo");
    }
    expect(
      await workspace.execute({
        kind: "redo",
        workspaceId: "workspace",
        invocationId: "redo-view-sort",
        actorId: "actor",
        selection: redo.redo,
      }),
    ).toMatchObject({ status: "published" });
    expect(
      (
        await workspace.query({
          kind: "outline",
          workspaceId: "workspace",
          perspective: "origin",
          rootNodeId: "host",
          maxDepth: 1,
        })
      ).rows.map((row) => row.nodeId),
    ).toEqual(["a-child", "z-child"]);

    expect(
      await workspace.execute(
        command("tamper-sort", [nodeAt("illegal-sort-value", "sort-field", "illegal-sort-value-occ", "illegal")]),
      ),
    ).toMatchObject({
      status: "rejected",
      error: { message: "Structural role requires a typed mutation: Tuple sort-field" },
    });
  });

  it("BREADTH-3 keeps View Sort isolated in Review until its Proposal is accepted", async () => {
    const workspace = await setup();
    await publish(
      workspace,
      command("proposal-fixture", [
        nodeAt("proposal-host", "workspace", "proposal-host-occ", "Host"),
        nodeAt("proposal-z", "proposal-host", "proposal-z-occ", "z"),
        nodeAt("proposal-a", "proposal-host", "proposal-a-occ", "A"),
      ]),
    );
    await publish(
      workspace,
      command("proposal-view", [
        {
          kind: "shared-default-view-definition-create",
          hostNodeId: "proposal-host",
          metanodeId: "proposal-host-meta",
          attachmentNodeId: "proposal-view-attachment",
          attachmentOccurrenceId: "proposal-view-attachment-occ",
          relationDefinitionOccurrenceId: "proposal-view-attachment-definition-occ",
          viewDefinitionNodeId: "proposal-view-definition",
          viewDefinitionOccurrenceId: "proposal-view-definition-occ",
          viewType: "outline",
          anchor: end,
        },
      ]),
    );
    const proposed = await workspace.execute(
      command(
        "propose-view-sort",
        [
          {
            kind: "shared-default-view-definition-sort-by-name-create",
            hostNodeId: "proposal-host",
            viewDefinitionNodeId: "proposal-view-definition",
            sortOrderFieldNodeId: "proposal-sort-order",
            sortOrderFieldOccurrenceId: "proposal-sort-order-occ",
            sortFieldNodeId: "proposal-sort-field",
            sortFieldOccurrenceId: "proposal-sort-field-occ",
            nodeNameOccurrenceId: "proposal-sort-node-name-occ",
            ascendingOccurrenceId: "proposal-sort-ascending-occ",
          },
        ],
        "proposal",
      ),
    );
    expect(proposed, JSON.stringify(proposed)).toMatchObject({ status: "published" });
    expect(await outlineNodeIds(workspace, "proposal-host", "origin")).toEqual(["proposal-z", "proposal-a"]);
    expect(await outlineNodeIds(workspace, "proposal-host", "review")).toEqual(["proposal-a", "proposal-z"]);

    for (let index = 0; index < 20; index += 1) {
      const review = await workspace.query({ kind: "review", workspaceId: "workspace" });
      if (!("hunks" in review) || review.hunks.length === 0) {
        break;
      }
      const hunk = required(review.hunks[0], "View Sort Review Hunk");
      const accepted = await workspace.execute({
        kind: "resolve-review",
        workspaceId: "workspace",
        invocationId: `accept-view-sort-${index}`,
        actorId: "reviewer",
        decision: "accept",
        selection: hunk.selection,
      });
      expect(accepted, JSON.stringify(accepted)).toMatchObject({ status: "published" });
    }
    const remaining = await workspace.query({ kind: "review", workspaceId: "workspace" });
    expect("hunks" in remaining ? remaining.hunks : []).toHaveLength(0);
    expect(await outlineNodeIds(workspace, "proposal-host", "origin")).toEqual(["proposal-a", "proposal-z"]);
  });
});

async function setup(): Promise<ProposalWorkspace> {
  const facts = await FactAuthorityStore.open({
    workspaceId: "workspace",
    replicaId: createReplicaId(),
    loroPeerId: "112",
    documents: new InMemoryDocumentStore(),
    admitRecords: admitAuthorityRecords,
  });
  return ProposalWorkspace.open({ workspaceId: "workspace", facts, versions });
}

function nodeAt(
  nodeId: string,
  parentNodeId: string,
  occurrenceId: string,
  text: string,
  intrinsicNodeType?: "field-definition",
): MutationCommand["mutations"][number] {
  return {
    kind: "node-create",
    nodeId,
    occurrenceId,
    parentNodeId,
    anchor: end,
    seed: textSeed(text),
    ...(intrinsicNodeType === undefined ? {} : { intrinsicNodeType }),
  };
}

function textSeed(text: string) {
  return { text: [{ value: text, attributes: {} }] } as const;
}

function command(
  invocationId: string,
  mutations: MutationCommand["mutations"],
  intent: MutationCommand["intent"] = "direct",
): MutationCommand {
  return {
    kind: "mutate",
    workspaceId: "workspace",
    invocationId,
    actorId: "actor",
    intent,
    historyChannelId: "breadth",
    mutations,
  };
}

async function outlineNodeIds(
  workspace: ProposalWorkspace,
  rootNodeId: string,
  perspective: "origin" | "review",
): Promise<readonly string[]> {
  const outline = await workspace.query({
    kind: "outline",
    workspaceId: "workspace",
    perspective,
    rootNodeId,
    maxDepth: 1,
  });
  return outline.rows.map((row) => row.nodeId);
}

async function publish(workspace: ProposalWorkspace, mutation: MutationCommand): Promise<void> {
  const result = await workspace.execute(mutation);
  expect(result, JSON.stringify(result)).toMatchObject({ status: "published" });
}

function debugNode(workspace: ProposalWorkspace, nodeId: string) {
  return workspace.query({ kind: "debug-node", workspaceId: "workspace", perspective: "origin", nodeId });
}

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}
