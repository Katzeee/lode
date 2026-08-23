import { describe, expect, it } from "vitest";

import type { EditCommand } from "@lode/sdk";
import type { EditAction } from "../../domain/edit/index.js";
import { FIELD_CARDINALITY_NODE_IDS, FIELD_DATATYPE_NODE_IDS } from "../../domain/fact/index.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import { InMemoryDocumentStore } from "../persistence/in-memory-document-store.js";
import { FactAuthority } from "./authority/fact-authority.js";
import { Workspace } from "./workspace.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("Field Value depth", () => {
  it("FIELD-VALUE-1 preserves list identities, nested Plain content, and reorder through Proposal, History, and restart", async () => {
    const documents = new InMemoryDocumentStore();
    let opened = await open(documents, "611");
    await establishFixture(opened.workspace);

    await publish(opened.workspace, command("alpha", [valueCreate("owner", "field", "alpha", "Alpha")]));
    await publish(
      opened.workspace,
      command("nested", [nodeAt("nested", "alpha", "nested-occurrence", "Nested child")]),
    );
    expect(
      await opened.workspace.execute(
        command("beta-proposal", [valueCreate("owner", "field", "beta", "Beta")], "proposal"),
      ),
    ).toMatchObject({ status: "published" });
    expect(await valueOccurrenceIds(opened.workspace, "origin", "owner")).toEqual(["alpha-occurrence"]);
    expect(await valueOccurrenceIds(opened.workspace, "review", "owner")).toEqual([
      "alpha-occurrence",
      "beta-occurrence",
    ]);

    await acceptAllReview(opened.workspace);
    expect(await valueOccurrenceIds(opened.workspace, "origin", "owner")).toEqual([
      "alpha-occurrence",
      "beta-occurrence",
    ]);
    expect(await outlineNodeIds(opened.workspace, "alpha")).toEqual(["nested"]);

    await publish(
      opened.workspace,
      command("reorder", [
        {
          kind: "occurrence-move",
          occurrenceId: "beta-occurrence",
          parentNodeId: "field-node",
          anchor: { after: null, before: "alpha-occurrence", affinity: "before", fallback: "start" },
        },
      ]),
    );
    expect(await valueOccurrenceIds(opened.workspace, "origin", "owner")).toEqual([
      "beta-occurrence",
      "alpha-occurrence",
    ]);
    expect(await outlineNodeIds(opened.workspace, "alpha")).toEqual(["nested"]);

    const history = await opened.workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "field-values",
    });
    if (!("undo" in history) || history.undo === null) {
      throw new Error("Expected Field Value reorder Undo");
    }
    await publishHistory(opened.workspace, {
      kind: "undo",
      workspaceId: "workspace",
      invocationId: "undo-reorder",
      actorId: "actor",
      selection: history.undo,
    });
    expect(await valueOccurrenceIds(opened.workspace, "origin", "owner")).toEqual([
      "alpha-occurrence",
      "beta-occurrence",
    ]);
    const redo = await opened.workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "field-values",
    });
    if (!("redo" in redo) || redo.redo === null) {
      throw new Error("Expected Field Value reorder Redo");
    }
    await publishHistory(opened.workspace, {
      kind: "redo",
      workspaceId: "workspace",
      invocationId: "redo-reorder",
      actorId: "actor",
      selection: redo.redo,
    });

    await opened.workspace.close();
    opened = await open(documents, "612");
    expect(await valueOccurrenceIds(opened.workspace, "origin", "owner")).toEqual([
      "beta-occurrence",
      "alpha-occurrence",
    ]);
    expect(await outlineNodeIds(opened.workspace, "alpha")).toEqual(["nested"]);
  });

  it("FIELD-VALUE-2 preserves overfull content across configuration changes and rejects new Single values and cross-Field moves", async () => {
    const opened = await open(new InMemoryDocumentStore(), "621");
    await establishFixture(opened.workspace);
    await publish(
      opened.workspace,
      command("two-values", [
        valueCreate("owner", "field", "alpha", "Alpha"),
        valueCreate("owner", "field", "beta", "Beta"),
      ]),
    );
    const stableValueIds = ["alpha-occurrence", "beta-occurrence"];

    await publish(
      opened.workspace,
      command("single", [
        {
          kind: "field-cardinality-configure",
          fieldDefinitionId: "field",
          cardinalityNodeId: FIELD_CARDINALITY_NODE_IDS.single,
        },
      ]),
    );
    expect(await valueOccurrenceIds(opened.workspace, "origin", "owner")).toEqual(stableValueIds);
    expect(
      await opened.workspace.execute(command("gamma", [valueCreate("owner", "field", "gamma", "Gamma")])),
    ).toMatchObject({
      status: "rejected",
      error: { message: "Single-value Field already has an authored value" },
    });

    await publish(
      opened.workspace,
      command("options", [
        {
          kind: "field-datatype-configure",
          fieldDefinitionId: "field",
          datatypeNodeId: FIELD_DATATYPE_NODE_IDS.options,
        },
      ]),
    );
    expect(await valueOccurrenceIds(opened.workspace, "origin", "owner")).toEqual(stableValueIds);
    await publish(
      opened.workspace,
      command("plain-list", [
        {
          kind: "field-datatype-configure",
          fieldDefinitionId: "field",
          datatypeNodeId: FIELD_DATATYPE_NODE_IDS.plain,
        },
        {
          kind: "field-cardinality-configure",
          fieldDefinitionId: "field",
          cardinalityNodeId: FIELD_CARDINALITY_NODE_IDS.list,
        },
      ]),
    );
    expect(await valueOccurrenceIds(opened.workspace, "origin", "owner")).toEqual(stableValueIds);

    await publish(
      opened.workspace,
      command("other-value", [valueCreate("other", "other-field", "other-value", "Other")]),
    );
    expect(
      await opened.workspace.execute(
        command("cross-field", [
          {
            kind: "occurrence-move",
            occurrenceId: "beta-occurrence",
            parentNodeId: "other-field-node",
            anchor: end,
          },
        ]),
      ),
    ).toMatchObject({
      status: "rejected",
      error: { message: "Field Values can only be reordered within their Field" },
    });
    expect(await valueOccurrenceIds(opened.workspace, "origin", "owner")).toEqual(stableValueIds);
  });
});

async function establishFixture(workspace: Workspace): Promise<void> {
  await publish(
    workspace,
    command("fixture", [
      nodeAt("owner", "workspace", "owner-occurrence", "Owner"),
      nodeAt("other", "workspace", "other-occurrence", "Other owner"),
      nodeAt("field", "workspace", "field-definition-occurrence", "Field", "field-definition"),
      nodeAt("other-field", "workspace", "other-field-definition-occurrence", "Other Field", "field-definition"),
    ]),
  );
  await publish(
    workspace,
    command("configuration", [
      datatypeConfiguration("field"),
      cardinalityConfiguration("field"),
      datatypeConfiguration("other-field"),
      cardinalityConfiguration("other-field"),
    ]),
  );
}

function datatypeConfiguration(fieldDefinitionId: string): Extract<EditAction, { kind: "field-datatype-configure" }> {
  return {
    kind: "field-datatype-configure",
    fieldDefinitionId,
    datatypeNodeId: FIELD_DATATYPE_NODE_IDS.plain,
  };
}

function cardinalityConfiguration(
  fieldDefinitionId: string,
): Extract<EditAction, { kind: "field-cardinality-configure" }> {
  return {
    kind: "field-cardinality-configure",
    fieldDefinitionId,
    cardinalityNodeId: FIELD_CARDINALITY_NODE_IDS.list,
  };
}

function valueCreate(ownerNodeId: string, prefix: string, valuePrefix: string, text: string): EditAction {
  return {
    kind: "field-value-create",
    ownerNodeId,
    fieldDefinitionId: prefix === "field" ? "field" : "other-field",
    fieldNodeId: `${prefix}-node`,
    fieldOccurrenceId: `${prefix}-occurrence`,
    valueNodeId: valuePrefix,
    valueOccurrenceId: `${valuePrefix}-occurrence`,
    anchor: end,
    seed: textSeed(text),
  };
}

function nodeAt(
  nodeId: string,
  parentNodeId: string,
  occurrenceId: string,
  text: string,
  intrinsicNodeType?: "field-definition",
): EditAction {
  return {
    kind: "node-create",
    nodeId,
    parentNodeId,
    occurrenceId,
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
  actions: EditCommand["actions"],
  intent: EditCommand["intent"] = "direct",
): EditCommand {
  return {
    kind: "edit",
    workspaceId: "workspace",
    invocationId,
    actorId: "actor",
    intent,
    historyChannelId: "field-values",
    actions,
  };
}

async function valueOccurrenceIds(
  workspace: Workspace,
  perspective: "origin" | "review",
  ownerNodeId: string,
): Promise<readonly string[]> {
  const result = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective,
    section: "materializedFields",
  });
  if (!("materializedFields" in result)) {
    throw new Error("Expected Materialized Field Projection");
  }
  return result.materializedFields[ownerNodeId]?.[0]?.valueOccurrenceIds ?? [];
}

async function outlineNodeIds(workspace: Workspace, rootNodeId: string): Promise<readonly string[]> {
  const result = await workspace.query({
    kind: "outline",
    workspaceId: "workspace",
    perspective: "origin",
    rootNodeId,
    maxDepth: 1,
  });
  return result.rows.map((row) => row.nodeId);
}

async function acceptAllReview(workspace: Workspace): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    const review = await workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in review) || review.hunks.length === 0) {
      return;
    }
    const hunk = review.hunks[0];
    if (hunk === undefined) {
      throw new Error("Expected Review Hunk");
    }
    await publishHistory(workspace, {
      kind: "resolve-review",
      workspaceId: "workspace",
      invocationId: `accept-value-${index}`,
      actorId: "reviewer",
      decision: "accept",
      selection: hunk.selection,
    });
  }
  throw new Error("Field Value Review did not settle");
}

async function open(documents: InMemoryDocumentStore, loroPeerId: `${number}`) {
  const facts = await FactAuthority.open({
    workspaceId: "workspace",
    loroPeerId,
    documents: documents,
  });
  return { facts, workspace: await Workspace.open({ workspaceId: "workspace", facts, versions }) };
}

async function publish(workspace: Workspace, command: EditCommand): Promise<void> {
  const result = await workspace.execute(command);
  expect(result, JSON.stringify(result)).toMatchObject({ status: "published" });
}

async function publishHistory(workspace: Workspace, commandValue: Parameters<Workspace["execute"]>[0]): Promise<void> {
  const result = await workspace.execute(commandValue);
  expect(result, JSON.stringify(result)).toMatchObject({ status: "published" });
}
