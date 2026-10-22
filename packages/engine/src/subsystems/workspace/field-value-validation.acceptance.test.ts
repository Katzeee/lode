import { describe, expect, it } from "vitest";
import type { EditAction, ProjectionPage, ProjectionPageSection } from "@lode/sdk";
import { END_SEQUENCE_ANCHOR as end, FIELD_DATATYPE_NODE_IDS } from "../../domain/fact/index.js";
import { InMemoryDocumentStore } from "../../../tests/support/document-store.js";
import { syncPair, testFactReplication } from "../../../tests/support/sync.js";
import { nodeAt } from "../../../tests/support/workspace/edit-test-actions.js";
import { openTestWorkspace, type TestWorkspace } from "../../../tests/support/workspace/open-test-workspace.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import { FactAuthority } from "./authority/fact-authority.js";

describe("Field content and datatype validation", () => {
  it("stores text and references independently of datatype and preserves them across configuration changes", async () => {
    const opened = await open("9141");
    const workspace = opened.workspace;
    await setup(workspace);
    await publish(workspace, "unconforming-content", [
      value("owner", "number", "text", "not a number"),
      value("reference-owner", "options", "external"),
    ]);
    await assertContent(workspace, "owner", "number", "text", "not a number", "invalid");
    await assertContent(workspace, "reference-owner", "options", "external", "External", "invalid");
    expect((await read(workspace, "nodeOwners")).nodeOwners.external).toBe("workspace");

    await publish(workspace, "plain", [datatype("number", FIELD_DATATYPE_NODE_IDS.plain)]);
    await assertContent(workspace, "owner", "number", "text", "not a number", null);
    await publish(workspace, "number", [datatype("number", FIELD_DATATYPE_NODE_IDS.number)]);
    await assertContent(workspace, "owner", "number", "text", "not a number", "invalid");
    await publish(workspace, "append-number-content", [value("owner", "number", "extra", "still not numeric")]);
    const fields = (await read(workspace, "materializedFields")).materializedFields.owner;
    expect(fields?.[0]?.valueOccurrenceIds).toEqual(["text-value", "extra-value"]);
    expect(textOf(await read(workspace, "nodes"), "extra")).toBe("still not numeric");
    await workspace.close();
  });

  it("keeps invalid content through Proposal, text History, reopen and replication", async () => {
    const documents = new InMemoryDocumentStore();
    const opened = await open("9142", documents);
    const workspace = opened.workspace;
    await setup(workspace);
    await publish(workspace, "propose-content", [value("owner", "number", "text", "invalid")], "proposal");
    expect((await read(workspace, "materializedFields")).materializedFields.owner).toBeUndefined();
    await assertContent(workspace, "owner", "number", "text", "invalid", "invalid", "review");
    await acceptReview(workspace);
    await assertContent(workspace, "owner", "number", "text", "invalid", "invalid");
    await publish(workspace, "edit-content", [
      { kind: "rich-text-splice", nodeId: "text", deleteAtomIds: [], anchor: end, insert: "!" },
    ]);
    await assertContent(workspace, "owner", "number", "text", "invalid!", "invalid");
    await history(workspace, "undo");
    await assertContent(workspace, "owner", "number", "text", "invalid", "invalid");
    await history(workspace, "redo");
    await assertContent(workspace, "owner", "number", "text", "invalid!", "invalid");
    await publish(workspace, "reference-content", [value("reference-owner", "options", "external")]);
    await workspace.close();

    const restarted = await open("9143", documents);
    await assertContent(restarted.workspace, "owner", "number", "text", "invalid!", "invalid");
    const replica = await open("9144");
    await sync(restarted, replica);
    await assertContent(replica.workspace, "owner", "number", "text", "invalid!", "invalid");
    await assertContent(replica.workspace, "reference-owner", "options", "external", "External", "invalid");
    expect((await read(replica.workspace, "nodeOwners")).nodeOwners.external).toBe("workspace");
    await restarted.workspace.close();
    await replica.workspace.close();
  });

  it("preserves new content while concurrent datatype configurations have no single interpretation", async () => {
    const left = await open("9145");
    const right = await open("9146");
    await setup(left.workspace);
    await sync(left, right);
    await publish(left.workspace, "left-type", [datatype("number", FIELD_DATATYPE_NODE_IDS.date)]);
    await publish(right.workspace, "right-type", [datatype("number", FIELD_DATATYPE_NODE_IDS.checkbox)]);
    await sync(left, right);
    const configurations = (await read(right.workspace, "fieldDefinitionConfigurations")).fieldDefinitionConfigurations;
    expect(configurations.number?.filter((configuration) => configuration.kind === "datatype")).toHaveLength(2);
    await publish(right.workspace, "content-with-conflict", [value("owner", "number", "text", "Keep this text")]);
    await assertContent(right.workspace, "owner", "number", "text", "Keep this text", null);
    await sync(right, left);
    await assertContent(left.workspace, "owner", "number", "text", "Keep this text", null);
    await left.workspace.close();
    await right.workspace.close();
  });
});

async function setup(workspace: TestWorkspace) {
  await publish(workspace, "setup", [
    nodeAt("owner", "workspace"),
    nodeAt("reference-owner", "workspace"),
    nodeAt("external", "workspace", undefined, { text: "External" }),
    nodeAt("tag", "workspace", undefined, { intrinsicNodeType: "supertag-definition" }),
    nodeAt("number", "workspace", undefined, { intrinsicNodeType: "field-definition" }),
    nodeAt("options", "workspace", undefined, { intrinsicNodeType: "field-definition" }),
    datatype("number", FIELD_DATATYPE_NODE_IDS.number),
    { ...datatype("options", FIELD_DATATYPE_NODE_IDS.optionsFromSupertag), optionsSupertagId: "tag" },
  ]);
}

function value(ownerNodeId: string, fieldDefinitionId: string, valueNodeId: string, text?: string): EditAction {
  return {
    kind: "field-value-create",
    ownerNodeId,
    fieldDefinitionId,
    valueNodeId,
    valueOccurrenceId: `${valueNodeId}-value`,
    anchor: end,
    ...(text === undefined ? {} : { seed: { text: [{ value: text, attributes: {} }] } }),
  };
}

function datatype(
  fieldDefinitionId: string,
  datatypeNodeId: string,
): Extract<EditAction, { kind: "field-datatype-configure" }> {
  return { kind: "field-datatype-configure", fieldDefinitionId, datatypeNodeId };
}

async function publish(
  workspace: TestWorkspace,
  invocationId: string,
  actions: readonly EditAction[],
  intent: "direct" | "proposal" = "direct",
) {
  const result = await workspace.execute({
    kind: "edit",
    workspaceId: "workspace",
    actorId: "actor",
    invocationId,
    historyChannelId: "content-validation",
    intent,
    actions,
  });
  expect(result, JSON.stringify(result)).toMatchObject({ status: "published" });
}

async function read<S extends ProjectionPageSection>(
  workspace: TestWorkspace,
  section: S,
  perspective: "origin" | "review" = "origin",
): Promise<ProjectionPage<S>> {
  const result = await workspace.query({ kind: "projection", workspaceId: "workspace", section, perspective });
  if (!("section" in result) || result.section !== section) {
    throw new Error(`Expected ${section}`);
  }
  return result as ProjectionPage<S>;
}

function textOf(projection: ProjectionPage<"nodes">, nodeId: string): string {
  return projection.nodes[nodeId]?.content.flatMap((atom) => (atom.kind === "text" ? [atom.value] : [])).join("") ?? "";
}

async function assertContent(
  workspace: TestWorkspace,
  ownerNodeId: string,
  fieldDefinitionId: string,
  nodeId: string,
  text: string,
  state: "invalid" | null,
  perspective: "origin" | "review" = "origin",
) {
  const fields = (await read(workspace, "materializedFields", perspective)).materializedFields;
  const field = fields[ownerNodeId]?.find((candidate) => candidate.fieldDefinitionId === fieldDefinitionId);
  expect(field?.valueOccurrenceIds).toEqual([`${nodeId}-value`]);
  const occurrences = (await read(workspace, "occurrences", perspective)).occurrences;
  expect(occurrences[`${nodeId}-value`]).toMatchObject({ nodeId, parentNodeId: field?.fieldNodeId });
  expect(textOf(await read(workspace, "nodes", perspective), nodeId)).toBe(text);
  const typed = (await read(workspace, "typedFieldValues", perspective)).typedFieldValues[ownerNodeId]?.find(
    (candidate) => candidate.fieldDefinitionId === fieldDefinitionId,
  );
  if (state === null) {
    expect(typed?.state).not.toBe("value");
  } else {
    expect(typed).toMatchObject({ state, value: null, valueOccurrenceIds: [`${nodeId}-value`] });
  }
}

async function acceptReview(workspace: TestWorkspace) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const review = await workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in review)) {
      throw new Error("Expected Review");
    }
    const hunk = review.hunks[0];
    if (hunk === undefined) {
      return;
    }
    expect(
      await workspace.execute({
        kind: "resolve-review",
        workspaceId: "workspace",
        actorId: "actor",
        invocationId: `accept-${attempt}`,
        decision: "accept",
        selection: hunk.selection,
      }),
    ).toMatchObject({ status: "published" });
  }
  throw new Error("Review did not settle");
}

async function history(workspace: TestWorkspace, kind: "undo" | "redo") {
  const projection = await workspace.query({
    kind: "history",
    workspaceId: "workspace",
    channelId: "content-validation",
  });
  if (!(kind in projection) || projection[kind] === null) {
    throw new Error(`Expected ${kind}`);
  }
  expect(
    await workspace.execute({
      kind,
      workspaceId: "workspace",
      actorId: "actor",
      invocationId: kind,
      selection: projection[kind],
    }),
  ).toMatchObject({ status: "published" });
}

async function open(loroPeerId: `${number}`, documents = new InMemoryDocumentStore()) {
  const facts = await FactAuthority.open({ workspaceId: "workspace", loroPeerId, documents });
  return { facts, workspace: await openTestWorkspace({ workspaceId: "workspace", facts, versions }) };
}

async function sync(left: Awaited<ReturnType<typeof open>>, right: Awaited<ReturnType<typeof open>>) {
  await syncPair(testFactReplication(left.facts.replication), testFactReplication(right.facts.replication));
  await left.workspace.reconcileAuthorityAdvance();
  await right.workspace.reconcileAuthorityAdvance();
}
