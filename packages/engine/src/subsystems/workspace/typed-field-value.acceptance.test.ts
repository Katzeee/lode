import { describe, expect, it } from "vitest";

import type { MutationCommand, TypedFieldValue } from "@lode/sdk";
import { admitAuthorityRecords } from "../../domain/admission/index.js";
import type { EditMutation } from "../../domain/edit/index.js";
import {
  FIELD_DATATYPE_NODE_IDS,
  fieldDefinitionEndpointOccurrenceId,
  type Mutation,
} from "../../domain/fact/index.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import { InMemoryDocumentStore } from "../persistence/in-memory-document-store.js";
import { syncPair } from "../../../tests/support/sync.js";
import { createReplicaId, FactAuthority } from "./authority/fact-authority.js";
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

    const numberNode = await opened.workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "nodes",
    });
    if (!("nodes" in numberNode) || numberNode.nodes["number-value"]?.content[0]?.kind !== "text") {
      throw new Error("Expected Number value text atom");
    }
    const rawNumberEdit = await opened.workspace.execute(
      command("reject-raw-number", "typed-values", [
        {
          kind: "text-splice",
          nodeId: "number-value",
          deleteAtomIds: [numberNode.nodes["number-value"].content[0].id],
          anchor: end,
          insert: "not-a-number",
        },
      ]),
    );
    expect(rawNumberEdit.status).toBe("rejected");
    if (rawNumberEdit.status !== "rejected") {
      throw new Error("Expected raw Number edit rejection");
    }
    expect(rawNumberEdit.error.message).toMatch(/requires a typed mutation/);

    const genericNumberCreate = await opened.workspace.execute(
      command("reject-generic-number-create", "typed-values", [
        {
          kind: "field-value-create",
          ownerNodeId: "owner",
          fieldDefinitionId: "number-field",
          fieldNodeId: "number-field-node",
          fieldOccurrenceId: "number-field-occurrence",
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
      fieldNodeId: "number-field-node",
      value: { valueNodeId: "number-value", valueOccurrenceId: "number-value-occurrence", value: -3 },
    });
    expect(await value(opened.workspace, "origin", "checkbox-field")).toMatchObject({
      fieldNodeId: "checkbox-field-node",
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
      fieldNodeId: "date-field-node",
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
      fieldNodeId: "number-field-node",
      state: "empty",
    });
    expect(await value(opened.workspace, "origin", "date-field")).toMatchObject({
      fieldNodeId: "date-field-node",
      state: "empty",
    });
    expect(await value(opened.workspace, "origin", "options-field")).toMatchObject({
      fieldNodeId: "options-field-node",
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
    await expect(smuggleInvalidOptionsValue(left.facts)).rejects.toThrow(/Materialized Field structure is invalid/);

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
        metanodeId: "option-alpha-metanode",
        supertagId: "option-tag",
        applicationNodeId: "option-alpha-application",
        applicationOccurrenceId: "option-alpha-application-occurrence",
        relationDefinitionOccurrenceId: "option-alpha-relation-definition-occurrence",
        definitionOccurrenceId: "option-alpha-tag-occurrence",
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
        optionsSupertagOccurrenceId: "options-datatype-source-occurrence",
      },
    ]),
  );
}

function datatypeConfiguration(
  prefix: string,
  datatypeNodeId: string,
): Extract<EditMutation, { kind: "field-datatype-configuration-create" }> {
  return {
    kind: "field-datatype-configuration-create",
    fieldDefinitionId: `${prefix}-field`,
    configurationNodeId: `${prefix}-datatype-configuration`,
    configurationOccurrenceId: `${prefix}-datatype-configuration-occurrence`,
    definitionOccurrenceId: `${prefix}-datatype-definition-occurrence`,
    valueOccurrenceId: `${prefix}-datatype-value-occurrence`,
    datatypeNodeId,
    anchor: end,
  };
}

function numberSet(value: number): Extract<EditMutation, { kind: "field-number-value-set" }> {
  return {
    kind: "field-number-value-set",
    ownerNodeId: "owner",
    fieldDefinitionId: "number-field",
    fieldNodeId: "number-field-node",
    fieldOccurrenceId: "number-field-occurrence",
    valueNodeId: "number-value",
    valueOccurrenceId: "number-value-occurrence",
    value,
  };
}

function dateSet(value: string): Extract<EditMutation, { kind: "field-date-value-set" }> {
  return {
    kind: "field-date-value-set",
    ownerNodeId: "owner",
    fieldDefinitionId: "date-field",
    fieldNodeId: "date-field-node",
    fieldOccurrenceId: "date-field-occurrence",
    valueNodeId: "date-value",
    valueOccurrenceId: "date-value-occurrence",
    value,
  };
}

function checkboxSet(
  value: boolean,
  valueOccurrenceId: string,
): Extract<EditMutation, { kind: "field-checkbox-value-set" }> {
  return {
    kind: "field-checkbox-value-set",
    ownerNodeId: "owner",
    fieldDefinitionId: "checkbox-field",
    fieldNodeId: "checkbox-field-node",
    fieldOccurrenceId: "checkbox-field-occurrence",
    valueOccurrenceId,
    value,
  };
}

function optionsSet(
  targetNodeId: string,
  valueOccurrenceId: string,
): Extract<EditMutation, { kind: "field-options-from-supertag-value-set" }> {
  return {
    kind: "field-options-from-supertag-value-set",
    ownerNodeId: "owner",
    fieldDefinitionId: "options-field",
    fieldNodeId: "options-field-node",
    fieldOccurrenceId: "options-field-occurrence",
    valueOccurrenceId,
    targetNodeId,
  };
}

function clear(
  prefix: "number" | "date" | "checkbox" | "options",
  emptyValueNodeId?: string,
  emptyValueOccurrenceId?: string,
): Extract<EditMutation, { kind: "typed-field-value-clear" }> {
  return {
    kind: "typed-field-value-clear",
    ownerNodeId: "owner",
    fieldDefinitionId: `${prefix}-field`,
    fieldNodeId: `${prefix}-field-node`,
    fieldOccurrenceId: `${prefix}-field-occurrence`,
    ...(emptyValueNodeId === undefined ? {} : { emptyValueNodeId, emptyValueOccurrenceId }),
  };
}

function nodeAt(
  nodeId: string,
  parentNodeId: string,
  occurrenceId: string,
  intrinsicNodeType?: "supertag-definition" | "field-definition",
): EditMutation {
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
  mutations: MutationCommand["mutations"],
  intent: MutationCommand["intent"] = "direct",
): MutationCommand {
  return {
    kind: "mutate",
    workspaceId: "workspace",
    invocationId,
    actorId: "actor",
    historyChannelId,
    intent,
    mutations,
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
    replicaId: createReplicaId(),
    loroPeerId,
    authorityJournal: documents,
    factReplication: documents,
    admitRecords: admitAuthorityRecords,
  });
  return { facts, workspace: await Workspace.open({ workspaceId: "workspace", facts, versions }) };
}

function smuggleInvalidOptionsValue(facts: FactAuthority) {
  const contribution = (mutation: Mutation) => ({
    kind: "contribution" as const,
    actorId: "remote",
    intent: "direct" as const,
    mutation,
  });
  return facts.commit({
    invocationId: "smuggle-invalid-options",
    request: { command: "smuggle-invalid-options" },
    writes: [
      {
        kind: "transaction",
        bodies: [
          contribution({ kind: "node-create", nodeId: "smuggled-options-field" }),
          contribution({
            kind: "node-owner-set",
            nodeId: "smuggled-options-field",
            ownerNodeId: "owner",
            previousOwnerNodeId: null,
          }),
          contribution({
            kind: "intrinsic-node-type-declare",
            nodeId: "smuggled-options-field",
            intrinsicNodeType: "field",
          }),
          contribution({
            kind: "occurrence-create",
            occurrenceId: "smuggled-options-field-occurrence",
            nodeId: "smuggled-options-field",
            parentNodeId: "owner",
            anchor: end,
          }),
          contribution({
            kind: "occurrence-create",
            occurrenceId: fieldDefinitionEndpointOccurrenceId("smuggled-options-field-occurrence"),
            nodeId: "options-field",
            parentNodeId: "smuggled-options-field",
            anchor: { after: null, before: null, affinity: "before", fallback: "start" },
          }),
          contribution({
            kind: "occurrence-create",
            occurrenceId: "smuggled-options-value-occurrence",
            nodeId: "not-an-option",
            parentNodeId: "smuggled-options-field",
            anchor: end,
          }),
          contribution({
            kind: "field-materialize",
            ownerNodeId: "owner",
            fieldDefinitionId: "options-field",
            fieldNodeId: "smuggled-options-field",
            fieldOccurrenceId: "smuggled-options-field-occurrence",
          }),
        ],
      },
    ],
    lineage: null,
    publishedFrontier: facts.snapshot().frontier,
  });
}
