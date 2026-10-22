import { describe, expect, it } from "vitest";
import type { EditAction, ProjectionPage, ProjectionPageSection } from "@lode/sdk";
import { InMemoryDocumentStore } from "../../../tests/support/document-store.js";
import { syncPair, testFactReplication } from "../../../tests/support/sync.js";
import { nodeAt } from "../../../tests/support/workspace/edit-test-actions.js";
import { openTestWorkspace, type TestWorkspace } from "../../../tests/support/workspace/open-test-workspace.js";
import {
  END_SEQUENCE_ANCHOR as end,
  fieldDefinitionEndpointOccurrenceId,
  materializedFieldNodeId,
  materializedFieldOccurrenceId,
} from "../../domain/fact/index.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import { FactAuthority } from "./authority/fact-authority.js";

describe("Field Definition ownership", () => {
  it("recognizes an owning Definition endpoint through generic graph creation, Proposal and durable replication", async () => {
    const documents = new InMemoryDocumentStore();
    const { workspace } = await open("9151", documents);
    await publish(workspace, "hosts", [nodeAt("owner", "workspace"), nodeAt("other", "workspace")]);
    const fieldNodeId = materializedFieldNodeId("owner", "definition");
    const fieldOccurrenceId = materializedFieldOccurrenceId("owner", "definition");
    const definitionOccurrenceId = fieldDefinitionEndpointOccurrenceId(fieldOccurrenceId);
    await publish(
      workspace,
      "local-field",
      [
        nodeAt(fieldNodeId, "owner", fieldOccurrenceId, { intrinsicNodeType: "field" }),
        nodeAt("definition", fieldNodeId, definitionOccurrenceId, {
          intrinsicNodeType: "field-definition",
          text: "Local field",
        }),
        { kind: "field-materialize", ownerNodeId: "owner", fieldDefinitionId: "definition" },
        value("owner", "first"),
      ],
      "proposal",
    );
    expect((await read(workspace, "materializedFields")).materializedFields.owner).toBeUndefined();
    await assertField(workspace, "owner", "first", "review");
    await acceptReview(workspace);
    await assertField(workspace, "owner", "first");
    await publish(workspace, "reuse-definition", [value("other", "second")]);
    await assertField(workspace, "other", "second");
    await workspace.close();

    const restarted = await open("9152", documents);
    await assertField(restarted.workspace, "owner", "first");
    await assertField(restarted.workspace, "other", "second");
    const replica = await open("9153");
    await syncPair(testFactReplication(restarted.facts.replication), testFactReplication(replica.facts.replication));
    await replica.workspace.reconcileAuthorityAdvance();
    await assertField(replica.workspace, "owner", "first");
    await assertField(replica.workspace, "other", "second");
    await restarted.workspace.close();
    await replica.workspace.close();
  });
});

function value(ownerNodeId: string, valueNodeId: string): EditAction {
  return {
    kind: "field-value-create",
    ownerNodeId,
    fieldDefinitionId: "definition",
    valueNodeId,
    valueOccurrenceId: `${valueNodeId}-occ`,
    anchor: end,
    seed: { text: [{ value: valueNodeId, attributes: {} }] },
  };
}

async function assertField(
  workspace: TestWorkspace,
  ownerNodeId: string,
  valueNodeId: string,
  perspective: "origin" | "review" = "origin",
) {
  const fieldNodeId = materializedFieldNodeId(ownerNodeId, "definition");
  const fieldOccurrenceId = materializedFieldOccurrenceId(ownerNodeId, "definition");
  const definitionOccurrenceId = fieldDefinitionEndpointOccurrenceId(fieldOccurrenceId);
  expect((await read(workspace, "materializedFields", perspective)).materializedFields[ownerNodeId]).toEqual([
    {
      ownerNodeId,
      fieldDefinitionId: "definition",
      fieldNodeId,
      fieldOccurrenceId,
      definitionOccurrenceId,
      valueOccurrenceIds: [`${valueNodeId}-occ`],
    },
  ]);
  expect((await read(workspace, "nodeOwners", perspective)).nodeOwners).toMatchObject({
    definition: materializedFieldNodeId("owner", "definition"),
    [fieldNodeId]: ownerNodeId,
    [valueNodeId]: fieldNodeId,
  });
  expect((await read(workspace, "childOccurrences", perspective)).childOccurrences[fieldNodeId]).toEqual([
    definitionOccurrenceId,
    `${valueNodeId}-occ`,
  ]);
  expect((await read(workspace, "occurrences", perspective)).occurrences[definitionOccurrenceId]).toMatchObject({
    nodeId: "definition",
    parentNodeId: fieldNodeId,
  });
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
    historyChannelId: "local-field",
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

async function open(loroPeerId: `${number}`, documents = new InMemoryDocumentStore()) {
  const facts = await FactAuthority.open({ workspaceId: "workspace", loroPeerId, documents });
  return { facts, workspace: await openTestWorkspace({ workspaceId: "workspace", facts, versions }) };
}
