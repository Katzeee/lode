import { describe, expect, it } from "vitest";

import type { EditCommand, TypedFieldValue } from "@lode/sdk";
import type { EditAction } from "../../domain/edit/index.js";
import { FIELD_DATATYPE_NODE_IDS, materializedFieldNodeId } from "../../domain/fact/index.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import { InMemoryDocumentStore } from "../persistence/in-memory-document-store.js";
import { syncPair } from "../../../tests/support/sync.js";
import { FactAuthority } from "./authority/fact-authority.js";
import { FactReplication } from "./fact-replication.js";
import { Workspace } from "./workspace.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("typed Field Values", () => {
  it("keeps typed value identity and three-state semantics through Proposal, History, clear, and restart", async () => {
    const documents = new InMemoryDocumentStore();
    const opened = await open(documents, "801");
    await establishFixture(opened.workspace);

    await execute(
      opened.workspace,
      command("set-typed-values", "typed-values", [
        numberSet(12.5),
        dateSet("2026-08-20"),
        checkboxSet(false, "checkbox-value-no"),
        optionsSet("option-alpha", "options-value-alpha"),
      ]),
    );
    expect(await value(opened.workspace, "origin", "number-field")).toMatchObject({
      state: "value",
      value: { kind: "number", valueNodeId: "number-value", value: 12.5 },
    });
    expect(await value(opened.workspace, "origin", "date-field")).toMatchObject({
      state: "value",
      value: { kind: "date", valueNodeId: "date-value", value: "2026-08-20" },
    });
    expect(await value(opened.workspace, "origin", "checkbox-field")).toMatchObject({
      state: "value",
      value: { kind: "checkbox", value: false },
    });
    expect(await value(opened.workspace, "origin", "options-field")).toMatchObject({
      state: "value",
      value: { kind: "options-from-supertag", targetNodeId: "option-alpha" },
    });

    const genericNumberCreate = await opened.workspace.execute(
      command("reject-generic-number-create", "typed-values", [
        {
          kind: "field-value-create",
          ownerNodeId: "owner",
          fieldDefinitionId: "number-field",
          valueNodeId: "generic-number-value",
          valueOccurrenceId: "generic-number-value-occurrence",
          anchor: end,
        },
      ]),
    );
    expect(genericNumberCreate.status).toBe("rejected");
    if (genericNumberCreate.status !== "rejected") {
      throw new Error("Expected generic Number create rejection");
    }
    expect(genericNumberCreate.error.message).toMatch(/require a typed value edit/);

    await execute(
      opened.workspace,
      command("edit-number-and-checkbox", "typed-values", [numberSet(-3), checkboxSet(true, "checkbox-value-yes")]),
    );
    expect(await value(opened.workspace, "origin", "number-field")).toMatchObject({
      fieldNodeId: materializedFieldNodeId("owner", "number-field"),
      value: { valueNodeId: "number-value", valueOccurrenceId: "number-value-occurrence", value: -3 },
    });
    expect(await value(opened.workspace, "origin", "checkbox-field")).toMatchObject({
      fieldNodeId: materializedFieldNodeId("owner", "checkbox-field"),
      state: "value",
      value: { kind: "checkbox", value: true },
    });

    await execute(opened.workspace, command("propose-date-edit", "typed-date", [dateSet("2026-08-21")], "proposal"));
    expect((await value(opened.workspace, "origin", "date-field"))?.value).toMatchObject({ value: "2026-08-20" });
    expect((await value(opened.workspace, "review", "date-field"))?.value).toMatchObject({ value: "2026-08-21" });
    const review = await opened.workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in review) || review.hunks.length !== 1) {
      throw new Error("Expected one Date value Review Hunk");
    }
    const hunk = review.hunks[0];
    if (hunk === undefined) {
      throw new Error("Expected Date value Review Hunk");
    }
    await execute(opened.workspace, {
      kind: "resolve-review",
      workspaceId: "workspace",
      invocationId: "accept-date-edit",
      actorId: "reviewer",
      decision: "accept",
      selection: hunk.selection,
    });
    expect(await value(opened.workspace, "origin", "date-field")).toMatchObject({
      fieldNodeId: materializedFieldNodeId("owner", "date-field"),
      value: { valueNodeId: "date-value", valueOccurrenceId: "date-value-occurrence", value: "2026-08-21" },
    });

    await execute(opened.workspace, command("date-edit-direct", "typed-date", [dateSet("2026-08-22")]));

    const history = await opened.workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "typed-date",
    });
    if (!("undo" in history) || history.undo === null) {
      throw new Error("Expected Date value Undo");
    }
    await execute(opened.workspace, {
      kind: "undo",
      workspaceId: "workspace",
      invocationId: "undo-date-edit",
      actorId: "actor",
      selection: history.undo,
    });
    expect((await value(opened.workspace, "origin", "date-field"))?.value).toMatchObject({ value: "2026-08-21" });

    const redoHistory = await opened.workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "typed-date",
    });
    if (!("redo" in redoHistory) || redoHistory.redo === null) {
      throw new Error("Expected Date value Redo");
    }
    await execute(opened.workspace, {
      kind: "redo",
      workspaceId: "workspace",
      invocationId: "redo-date-edit",
      actorId: "actor",
      selection: redoHistory.redo,
    });
    expect((await value(opened.workspace, "origin", "date-field"))?.value).toMatchObject({ value: "2026-08-22" });

    await execute(
      opened.workspace,
      command("clear-typed-values", "typed-clear", [
        clear("number", "number-empty", "number-empty-occurrence"),
        clear("date", "date-empty", "date-empty-occurrence"),
        clear("options", "options-empty", "options-empty-occurrence"),
        clear("checkbox"),
      ]),
    );
    expect(await value(opened.workspace, "origin", "number-field")).toMatchObject({
      fieldNodeId: materializedFieldNodeId("owner", "number-field"),
      state: "empty",
    });
    expect(await value(opened.workspace, "origin", "date-field")).toMatchObject({
      fieldNodeId: materializedFieldNodeId("owner", "date-field"),
      state: "empty",
    });
    expect(await value(opened.workspace, "origin", "options-field")).toMatchObject({
      fieldNodeId: materializedFieldNodeId("owner", "options-field"),
      state: "empty",
    });
    expect(await value(opened.workspace, "origin", "checkbox-field")).toBeUndefined();

    await opened.workspace.close();
    const restarted = await open(documents, "802");
    expect(await value(restarted.workspace, "origin", "number-field")).toMatchObject({ state: "empty" });
    expect(await value(restarted.workspace, "origin", "checkbox-field")).toBeUndefined();
  });

  it("validates the configured datatype and Options target membership and syncs typed Projection", async () => {
    const left = await open(new InMemoryDocumentStore(), "901");
    const right = await open(new InMemoryDocumentStore(), "902");
    await establishFixture(left.workspace);

    const invalidOption = await left.workspace.execute(
      command("reject-option", "typed-values", [optionsSet("not-an-option", "invalid-option-occurrence")]),
    );
    expect(invalidOption.status).toBe("rejected");
    if (invalidOption.status !== "rejected") {
      throw new Error("Expected invalid Options target rejection");
    }
    expect(invalidOption.error.message).toMatch(/does not match the configured Supertag/);
    const invalidDatatype = await left.workspace.execute(
      command("reject-number", "typed-values", [{ ...dateSet("2026-08-20"), fieldDefinitionId: "number-field" }]),
    );
    expect(invalidDatatype.status).toBe("rejected");
    if (invalidDatatype.status !== "rejected") {
      throw new Error("Expected typed Datatype rejection");
    }
    expect(invalidDatatype.error.message).toMatch(/not configured as Date/);
    await execute(
      left.workspace,
      command("sync-typed-values", "typed-values", [numberSet(-3), checkboxSet(true, "checkbox-value-yes")]),
    );
    await syncPair(new FactReplication(left.facts.replication), new FactReplication(right.facts.replication));
    await left.workspace.reconcileAuthorityAdvance();
    await right.workspace.reconcileAuthorityAdvance();
    expect(await value(right.workspace, "origin", "number-field")).toMatchObject({
      state: "value",
      value: { kind: "number", value: -3 },
    });
    expect(await value(right.workspace, "origin", "checkbox-field")).toMatchObject({
      state: "value",
      value: { kind: "checkbox", value: true },
    });
  });
});

async function establishFixture(workspace: Workspace): Promise<void> {
  await execute(
    workspace,
    command("typed-fixture", "setup", [
      nodeAt("owner", "workspace", "owner-occurrence"),
      nodeAt("option-alpha", "workspace", "option-alpha-occurrence"),
      nodeAt("not-an-option", "workspace", "not-an-option-occurrence"),
      nodeAt("option-tag", "workspace", "option-tag-occurrence", "supertag-definition"),
      nodeAt("number-field", "workspace", "number-field-definition-occurrence", "field-definition"),
      nodeAt("date-field", "workspace", "date-field-definition-occurrence", "field-definition"),
      nodeAt("checkbox-field", "workspace", "checkbox-field-definition-occurrence", "field-definition"),
      nodeAt("options-field", "workspace", "options-field-definition-occurrence", "field-definition"),
    ]),
  );
  await execute(
    workspace,
    command("tag-option", "setup", [
      {
        kind: "supertag-application-create",
        hostNodeId: "option-alpha",
        supertagId: "option-tag",
        anchor: end,
      },
    ]),
  );
  await execute(
    workspace,
    command("configure-typed-fields", "setup", [
      datatypeConfiguration("number", FIELD_DATATYPE_NODE_IDS.number),
      datatypeConfiguration("date", FIELD_DATATYPE_NODE_IDS.date),
      datatypeConfiguration("checkbox", FIELD_DATATYPE_NODE_IDS.checkbox),
      {
        ...datatypeConfiguration("options", FIELD_DATATYPE_NODE_IDS.optionsFromSupertag),
        optionsSupertagId: "option-tag",
      },
    ]),
  );
}

function datatypeConfiguration(
  prefix: string,
  datatypeNodeId: string,
): Extract<EditAction, { kind: "field-datatype-configure" }> {
  return {
    kind: "field-datatype-configure",
    fieldDefinitionId: `${prefix}-field`,
    datatypeNodeId,
  };
}

function numberSet(value: number): Extract<EditAction, { kind: "field-number-value-set" }> {
  return {
    kind: "field-number-value-set",
    ownerNodeId: "owner",
    fieldDefinitionId: "number-field",
    valueNodeId: "number-value",
    valueOccurrenceId: "number-value-occurrence",
    value,
  };
}

function dateSet(value: string): Extract<EditAction, { kind: "field-date-value-set" }> {
  return {
    kind: "field-date-value-set",
    ownerNodeId: "owner",
    fieldDefinitionId: "date-field",
    valueNodeId: "date-value",
    valueOccurrenceId: "date-value-occurrence",
    value,
  };
}

function checkboxSet(
  value: boolean,
  valueOccurrenceId: string,
): Extract<EditAction, { kind: "field-checkbox-value-set" }> {
  return {
    kind: "field-checkbox-value-set",
    ownerNodeId: "owner",
    fieldDefinitionId: "checkbox-field",
    valueOccurrenceId,
    value,
  };
}

function optionsSet(
  targetNodeId: string,
  valueOccurrenceId: string,
): Extract<EditAction, { kind: "field-options-from-supertag-value-set" }> {
  return {
    kind: "field-options-from-supertag-value-set",
    ownerNodeId: "owner",
    fieldDefinitionId: "options-field",
    valueOccurrenceId,
    targetNodeId,
  };
}

function clear(
  prefix: "number" | "date" | "checkbox" | "options",
  emptyValueNodeId?: string,
  emptyValueOccurrenceId?: string,
): Extract<EditAction, { kind: "typed-field-value-clear" }> {
  return {
    kind: "typed-field-value-clear",
    ownerNodeId: "owner",
    fieldDefinitionId: `${prefix}-field`,
    ...(emptyValueNodeId === undefined ? {} : { emptyValueNodeId, emptyValueOccurrenceId }),
  };
}

function nodeAt(
  nodeId: string,
  parentNodeId: string,
  occurrenceId: string,
  intrinsicNodeType?: "supertag-definition" | "field-definition",
): EditAction {
  return {
    kind: "node-create",
    nodeId,
    parentNodeId,
    occurrenceId,
    anchor: end,
    ...(intrinsicNodeType === undefined ? {} : { intrinsicNodeType }),
  };
}

async function value(
  workspace: Workspace,
  perspective: "origin" | "review",
  fieldDefinitionId: string,
): Promise<TypedFieldValue | undefined> {
  const result = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective,
    section: "typedFieldValues",
  });
  if (!("typedFieldValues" in result)) {
    throw new Error("Expected Typed Field Values Projection");
  }
  return result.typedFieldValues.owner?.find((field) => field.fieldDefinitionId === fieldDefinitionId);
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
    historyChannelId,
    intent,
    actions,
  };
}

async function execute(workspace: Workspace, command: Parameters<Workspace["execute"]>[0]) {
  const result = await workspace.execute(command);
  if (result.status === "rejected") {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  expect(result.status, JSON.stringify(result)).toBe("published");
  return result;
}

async function open(documents: InMemoryDocumentStore, loroPeerId: `${number}`) {
  const facts = await FactAuthority.open({
    workspaceId: "workspace",
    loroPeerId,
    documents: documents,
  });
  return { facts, workspace: await Workspace.open({ workspaceId: "workspace", facts, versions }) };
}
