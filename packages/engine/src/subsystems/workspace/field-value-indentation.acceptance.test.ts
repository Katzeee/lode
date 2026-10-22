import { describe, expect, it } from "vitest";
import type { EditAction, ProjectionPage, ProjectionPageSection } from "@lode/sdk";
import { END_SEQUENCE_ANCHOR as end, FIELD_CARDINALITY_NODE_IDS, FIELD_DATATYPE_NODE_IDS } from "@lode/sdk";
import { openTestWorkspace, type TestWorkspace } from "../../../tests/support/workspace/open-test-workspace.js";
import { InMemoryDocumentStore } from "../../../tests/support/document-store.js";
import { syncPair, testFactReplication } from "../../../tests/support/sync.js";
import { nodeAt } from "../../../tests/support/workspace/edit-test-actions.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import { FactAuthority } from "./authority/fact-authority.js";

describe("Field content structure", () => {
  it("moves a value and its subtree into a sibling and out again with the same identities through History", async () => {
    const { workspace } = await fixture("861");
    const field = await fieldFor(workspace, "owner");
    await publish(workspace, "beta-child", [nodeAt("nested", "beta", "nested-occ", { text: "Nested" })]);
    await publish(workspace, "indent", [move("beta-occ", "alpha")]);
    await assertPlacement(workspace, "alpha", ["alpha-occ"]);
    await history(workspace, "undo", "undo-indent");
    await assertPlacement(workspace, field.fieldNodeId, ["alpha-occ", "beta-occ"]);
    await history(workspace, "redo", "redo-indent");
    await assertPlacement(workspace, "alpha", ["alpha-occ"]);
    await publish(workspace, "outdent", [move("beta-occ", field.fieldNodeId)]);
    await assertPlacement(workspace, field.fieldNodeId, ["alpha-occ", "beta-occ"]);
    await history(workspace, "undo", "undo-outdent");
    await assertPlacement(workspace, "alpha", ["alpha-occ"]);
    await history(workspace, "redo", "redo-outdent");
    await assertPlacement(workspace, field.fieldNodeId, ["alpha-occ", "beta-occ"]);
    await workspace.close();
  });

  it("moves owning content through ordinary parents and Field values under Options and Single configuration", async () => {
    const { workspace } = await fixture("862");
    const destination = await fieldFor(workspace, "other");
    await publish(workspace, "beta-child", [nodeAt("nested", "beta", "nested-occ", { text: "Nested" })]);
    await publish(workspace, "indent", [move("beta-occ", "alpha")]);
    await publish(workspace, "outside-field", [move("beta-occ", "owner")]);
    await assertPlacement(workspace, "owner", ["alpha-occ"]);
    expect((await read(workspace, "childOccurrences")).childOccurrences.alpha ?? []).not.toContain("beta-occ");
    await publish(workspace, "into-other-field", [move("beta-occ", destination.fieldNodeId)]);
    await assertPlacement(workspace, destination.fieldNodeId, ["alpha-occ"]);
    expect((await fieldFor(workspace, "other")).valueOccurrenceIds).toEqual(["other-value-occ", "beta-occ"]);
    await publish(workspace, "options", [
      { kind: "field-datatype-configure", fieldDefinitionId: "field", datatypeNodeId: FIELD_DATATYPE_NODE_IDS.options },
    ]);
    await publish(workspace, "options-indent", [move("beta-occ", "other-value")]);
    await assertPlacement(workspace, "other-value", ["alpha-occ"]);
    expect((await fieldFor(workspace, "other")).valueOccurrenceIds).toEqual(["other-value-occ"]);
    await publish(workspace, "single", [
      {
        kind: "field-cardinality-configure",
        fieldDefinitionId: "field",
        cardinalityNodeId: FIELD_CARDINALITY_NODE_IDS.single,
      },
    ]);
    await publish(workspace, "single-outdent", [move("beta-occ", destination.fieldNodeId)]);
    await assertPlacement(workspace, destination.fieldNodeId, ["alpha-occ"]);
    await publish(workspace, "single-create", [value("other", "gamma")]);
    expect((await fieldFor(workspace, "other")).valueOccurrenceIds).toEqual([
      "other-value-occ",
      "beta-occ",
      "gamma-occ",
    ]);
    await workspace.close();
  });

  it("moves a Field Reference without changing its Original through History, reopen and replication", async () => {
    const documents = new InMemoryDocumentStore();
    const { workspace } = await fixture("863", documents);
    const field = await fieldFor(workspace, "owner");
    await publish(workspace, "reference", [
      nodeAt("source", "workspace", "source-original", { text: "Shared source" }),
      {
        kind: "field-value-create",
        ownerNodeId: "owner",
        fieldDefinitionId: "field",
        valueNodeId: "source",
        valueOccurrenceId: "source-reference",
        anchor: end,
      },
    ]);
    await publish(workspace, "reference-indent", [move("source-reference", "beta")]);
    await assertReference(workspace, "beta");
    expect((await fieldFor(workspace, "owner")).valueOccurrenceIds).toEqual(["alpha-occ", "beta-occ"]);
    await history(workspace, "undo", "undo-reference-indent");
    await assertReference(workspace, field.fieldNodeId);
    await history(workspace, "redo", "redo-reference-indent");
    await assertReference(workspace, "beta");
    await reject(workspace, "duplicate-original", [move("source-reference", "workspace")]);
    await workspace.close();
    const restarted = await open("864", documents);
    await assertReference(restarted.workspace, "beta");
    const replica = await open("865");
    await syncPair(testFactReplication(restarted.facts.replication), testFactReplication(replica.facts.replication));
    await replica.workspace.reconcileAuthorityAdvance();
    await assertReference(replica.workspace, "beta");
    await restarted.workspace.close();
    await replica.workspace.close();
  });
});

async function fieldFor(workspace: TestWorkspace, owner: string) {
  const field = (await read(workspace, "materializedFields")).materializedFields[owner]?.[0];
  if (!field) {
    throw new Error(`Expected a materialized Field on ${owner}`);
  }
  return field;
}

async function fixture(loroPeerId: `${number}`, documents = new InMemoryDocumentStore()) {
  const opened = await open(loroPeerId, documents);
  const { workspace } = opened;
  await publish(workspace, "setup", [
    nodeAt("owner", "workspace"),
    nodeAt("other", "workspace"),
    nodeAt("field", "workspace", undefined, { intrinsicNodeType: "field-definition" }),
    {
      kind: "field-cardinality-configure",
      fieldDefinitionId: "field",
      cardinalityNodeId: FIELD_CARDINALITY_NODE_IDS.list,
    },
    value("owner", "alpha"),
    value("owner", "beta"),
    value("other", "other-value"),
  ]);
  return opened;
}
async function open(loroPeerId: `${number}`, documents = new InMemoryDocumentStore()) {
  const facts = await FactAuthority.open({ workspaceId: "workspace", loroPeerId, documents });
  return { facts, workspace: await openTestWorkspace({ workspaceId: "workspace", facts, versions }) };
}
function value(ownerNodeId: string, valueNodeId: string): EditAction {
  return {
    kind: "field-value-create",
    ownerNodeId,
    fieldDefinitionId: "field",
    valueNodeId,
    valueOccurrenceId: `${valueNodeId}-occ`,
    anchor: end,
    seed: { text: [{ value: valueNodeId, attributes: {} }] },
  };
}
function move(occurrenceId: string, parentNodeId: string): EditAction {
  return { kind: "occurrence-move", occurrenceId, parentNodeId, anchor: end };
}
async function execute(workspace: TestWorkspace, invocationId: string, actions: readonly EditAction[]) {
  return workspace.execute({
    kind: "edit",
    workspaceId: "workspace",
    actorId: "actor",
    invocationId,
    intent: "direct",
    historyChannelId: "field-indent",
    actions,
  });
}
async function publish(workspace: TestWorkspace, invocationId: string, actions: readonly EditAction[]) {
  const result = await execute(workspace, invocationId, actions);
  expect(result, JSON.stringify(result)).toMatchObject({ status: "published" });
}
async function reject(workspace: TestWorkspace, invocationId: string, actions: readonly EditAction[]) {
  expect(await execute(workspace, invocationId, actions)).toMatchObject({ status: "rejected" });
}
async function read<S extends ProjectionPageSection>(workspace: TestWorkspace, section: S): Promise<ProjectionPage<S>> {
  const result = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective: "origin",
    section,
  });
  if (!("section" in result) || result.section !== section) {
    throw new Error(`Expected ${section}`);
  }
  return result as ProjectionPage<S>;
}
async function history(workspace: TestWorkspace, operation: "undo" | "redo", invocationId: string) {
  const history = await workspace.query({ kind: "history", workspaceId: "workspace", channelId: "field-indent" });
  if (!(operation in history) || history[operation] === null) {
    throw new Error(`Expected ${operation}`);
  }
  expect(
    await workspace.execute({
      kind: operation,
      workspaceId: "workspace",
      actorId: "actor",
      invocationId,
      selection: history[operation],
    }),
  ).toMatchObject({ status: "published" });
}
async function assertPlacement(workspace: TestWorkspace, parentNodeId: string, valueOccurrenceIds: readonly string[]) {
  const field = await fieldFor(workspace, "owner");
  const children = (await read(workspace, "childOccurrences")).childOccurrences;
  const occurrences = (await read(workspace, "occurrences")).occurrences;
  const owners = (await read(workspace, "nodeOwners")).nodeOwners;
  const nodes = (await read(workspace, "nodes")).nodes;
  expect(field.valueOccurrenceIds).toEqual(valueOccurrenceIds);
  expect(occurrences["beta-occ"]).toMatchObject({ nodeId: "beta", parentNodeId });
  expect(owners.beta).toBe(parentNodeId);
  expect(children[parentNodeId]).toContain("beta-occ");
  expect(children.beta).toEqual(["nested-occ"]);
  expect(occurrences["nested-occ"]).toMatchObject({ nodeId: "nested", parentNodeId: "beta" });
  expect(owners.nested).toBe("beta");
  expect(nodes.beta?.content.flatMap((atom) => (atom.kind === "text" ? [atom.value] : [])).join("")).toBe("beta");
  expect(Object.values(occurrences).filter((occurrence) => occurrence.nodeId === "beta")).toHaveLength(1);
}

async function assertReference(workspace: TestWorkspace, parentNodeId: string) {
  const occurrences = (await read(workspace, "occurrences")).occurrences;
  expect(occurrences["source-original"]).toMatchObject({ nodeId: "source", parentNodeId: "workspace" });
  expect(occurrences["source-reference"]).toMatchObject({ nodeId: "source", parentNodeId });
  expect((await read(workspace, "nodeOwners")).nodeOwners.source).toBe("workspace");
  expect((await read(workspace, "childOccurrences")).childOccurrences[parentNodeId]).toContain("source-reference");
  const content = (await read(workspace, "nodes")).nodes.source?.content;
  expect(content?.flatMap((atom) => (atom.kind === "text" ? [atom.value] : [])).join("")).toBe("Shared source");
}
