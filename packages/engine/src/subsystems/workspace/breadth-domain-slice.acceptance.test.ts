import {
  openTestWorkspace,
  type TestWorkspace as Workspace,
} from "../../../tests/support/workspace/open-test-workspace.js";
import { describe, expect, it } from "vitest";

import type { EditCommand, ProjectionPageSection, ProjectionSections } from "@lode/sdk";
import {
  CODE_BLOCK_LANGUAGE_DEFINITION_NODE_ID,
  END_SEQUENCE_ANCHOR as end,
  materializedFieldNodeId,
  URL_DEFINITION_NODE_ID,
} from "../../domain/fact/index.js";
import { InMemoryDocumentStore } from "../../../tests/support/document-store.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import { FactAuthority } from "./authority/fact-authority.js";
import { nodeAt } from "../../../tests/support/workspace/edit-test-actions.js";

describe("breadth-first domain slice", () => {
  it("BREADTH-1 exposes Projection, Outline, URL Node, Code Node, and Field Value as formal capabilities", async () => {
    const workspace = await setup();
    await publish(
      workspace,
      command("fixture", [
        nodeAt("debug-target", "workspace", "debug-target-occ", { text: "Debug target" }),
        nodeAt("code-target", "workspace", "code-target-occ", { text: "const answer = 42;" }),
        nodeAt("field-host", "workspace", "field-host-occ", { text: "Field host" }),
        nodeAt("field-definition", "workspace", "field-definition-occ", {
          text: "Field",
          intrinsicNodeType: "field-definition",
        }),
        nodeAt("outline-root", "workspace", "outline-root-occ", { text: "Outline root" }),
        nodeAt("outline-b", "outline-root", "outline-b-occ", { text: "B" }),
        nodeAt("outline-a", "outline-root", "outline-a-occ", { text: "A" }),
        nodeAt("outline-grandchild", "outline-b", "outline-grandchild-occ", { text: "Grandchild" }),
      ]),
    );

    expect((await projectionSection(workspace, "nodes"))["debug-target"]).toMatchObject({ nodeId: "debug-target" });
    expect((await projectionSection(workspace, "metanodes"))["debug-target"]).toBeUndefined();

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
          urlValueNodeId: "url-value",
          urlValueOccurrenceId: "url-value-occ",
          url: "https://example.com/lode",
        },
      ]),
    );
    expect(await projectedFieldValueText(workspace, "url-node", URL_DEFINITION_NODE_ID)).toBe(
      "https://example.com/lode",
    );

    await publish(
      workspace,
      command("code-configure", [
        {
          kind: "code-node-configure",
          nodeId: "code-target",
          languageValueNodeId: "code-language-value",
          languageValueOccurrenceId: "code-language-value-occ",
          language: "JavaScript",
        },
      ]),
    );
    expect(await projectedFieldValueText(workspace, "code-target", CODE_BLOCK_LANGUAGE_DEFINITION_NODE_ID)).toBe(
      "JavaScript",
    );

    await publish(
      workspace,
      command("field-values", [
        {
          kind: "field-value-create",
          ownerNodeId: "field-host",
          fieldDefinitionId: "field-definition",
          valueNodeId: "field-value-a",
          valueOccurrenceId: "field-value-a-occ",
          anchor: end,
          seed: textSeed("Alpha"),
        },
        {
          kind: "field-value-create",
          ownerNodeId: "field-host",
          fieldDefinitionId: "field-definition",
          valueNodeId: "field-value-b",
          valueOccurrenceId: "field-value-b-occ",
          anchor: end,
          seed: textSeed("Beta"),
        },
      ]),
    );
    expect((await projectionSection(workspace, "materializedFields"))["field-host"]).toEqual([
      expect.objectContaining({
        fieldDefinitionId: "field-definition",
        fieldNodeId: materializedFieldNodeId("field-host", "field-definition"),
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

  it("BREADTH-2 applies semantic node-name sort and restores both the option and sequence through History", async () => {
    const workspace = await setup();
    await publish(
      workspace,
      command("view-fixture", [
        nodeAt("host", "workspace", "host-occ", { text: "Host" }),
        nodeAt("z-child", "host", "z-child-occ", { text: "z" }),
        nodeAt("a-child", "host", "a-child-occ", { text: "A" }),
      ]),
    );
    await publish(
      workspace,
      command("view-create", [
        {
          kind: "shared-default-view-create",
          hostNodeId: "host",
          viewType: "outline",
          anchor: end,
        },
      ]),
    );
    const viewId = await sharedViewId(workspace, "host");
    await publish(
      workspace,
      command("view-sort", [
        {
          kind: "view-sort-by-node-name",
          hostNodeId: "host",
          viewId,
          direction: "ascending",
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
    expect(definitions.sharedDefaultViewDefinitions.host?.[0]?.options.sort).toMatchObject({
      direction: "ascending",
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
    expect(definitionsAfterUndo.sharedDefaultViewDefinitions.host?.[0]?.options.sort).toBeNull();
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
  });

  it("BREADTH-3 keeps View Sort isolated in Review until its Proposal is accepted", async () => {
    const workspace = await setup();
    await publish(
      workspace,
      command("proposal-fixture", [
        nodeAt("proposal-host", "workspace", "proposal-host-occ", { text: "Host" }),
        nodeAt("proposal-z", "proposal-host", "proposal-z-occ", { text: "z" }),
        nodeAt("proposal-a", "proposal-host", "proposal-a-occ", { text: "A" }),
      ]),
    );
    await publish(
      workspace,
      command("proposal-view", [
        {
          kind: "shared-default-view-create",
          hostNodeId: "proposal-host",
          viewType: "outline",
          anchor: end,
        },
      ]),
    );
    const proposalViewId = await sharedViewId(workspace, "proposal-host");
    const proposed = await workspace.execute(
      command(
        "propose-view-sort",
        [
          {
            kind: "view-sort-by-node-name",
            hostNodeId: "proposal-host",
            viewId: proposalViewId,
            direction: "ascending",
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

async function setup(): Promise<Workspace> {
  const facts = await FactAuthority.open({
    workspaceId: "workspace",
    loroPeerId: "112",
    documents: new InMemoryDocumentStore(),
  });
  return openTestWorkspace({ workspaceId: "workspace", facts, versions });
}

function textSeed(text: string) {
  return { text: [{ value: text, attributes: {} }] } as const;
}

function command(
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
    historyChannelId: "breadth",
    actions,
  };
}

async function outlineNodeIds(
  workspace: Workspace,
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

async function sharedViewId(workspace: Workspace, hostNodeId: string) {
  const projection = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective: "origin",
    section: "sharedDefaultViewDefinitions",
  });
  if (!("sharedDefaultViewDefinitions" in projection)) {
    throw new Error("Expected View Definition Projection");
  }
  return required(projection.sharedDefaultViewDefinitions[hostNodeId]?.[0], "shared View Definition").viewId;
}

async function publish(workspace: Workspace, command: EditCommand): Promise<void> {
  const result = await workspace.execute(command);
  expect(result, JSON.stringify(result)).toMatchObject({ status: "published" });
}

async function projectedFieldValueText(
  workspace: Workspace,
  nodeId: string,
  fieldDefinitionId: string,
): Promise<string | null> {
  const fields = (await projectionSection(workspace, "materializedFields"))[nodeId] ?? [];
  const field = fields.find((candidate) => candidate.fieldDefinitionId === fieldDefinitionId);
  const valueOccurrenceId = field?.valueOccurrenceIds[0];
  if (valueOccurrenceId === undefined) {
    return null;
  }
  const occurrence = (await projectionSection(workspace, "occurrences"))[valueOccurrenceId];
  const node = occurrence === undefined ? undefined : (await projectionSection(workspace, "nodes"))[occurrence.nodeId];
  return node?.content.flatMap((item) => (item.kind === "text" ? [item.value] : [])).join("") ?? null;
}

async function projectionSection<Section extends ProjectionPageSection>(
  workspace: Workspace,
  section: Section,
): Promise<ProjectionSections[Section]> {
  const page = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective: "origin",
    section,
  });
  if (page.section !== section) {
    throw new Error(`Expected ${section} Projection`);
  }
  const selected = (page as unknown as Readonly<Record<string, unknown>>)[section];
  return selected as ProjectionSections[Section];
}

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}
