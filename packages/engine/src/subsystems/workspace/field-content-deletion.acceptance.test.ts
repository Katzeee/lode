import { openTestWorkspace } from "../../../tests/support/workspace/open-test-workspace.js";
import { describe, expect, it } from "vitest";

import type { ProjectionPage } from "@lode/sdk";
import type { EditAction } from "../../domain/edit/index.js";
import {
  materializedFieldNodeId,
  materializedFieldOccurrenceId,
  type ProjectionPerspective,
} from "../../domain/fact/index.js";
import { InMemoryDocumentStore } from "../../../tests/support/document-store.js";
import { FactAuthority } from "./authority/fact-authority.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import { nodeAt } from "../../../tests/support/workspace/edit-test-actions.js";

const FIELD_NODE_ID = materializedFieldNodeId("owner", "field-definition");
const FIELD_OCCURRENCE_ID = materializedFieldOccurrenceId("owner", "field-definition");

describe("instance Field content deletion", () => {
  it("deletes one ordered Field Value through Proposal, Direct, Reject, and History", async () => {
    const fixture = await open(new InMemoryDocumentStore(), "601");
    expect((await mutate(fixture, "setup-values", explicitFieldProgram())).status).toBe("published");

    expect(
      (await mutate(fixture, "propose-value-delete", [valueDeletion("value-a-occurrence")], "proposal")).status,
    ).toBe("published");
    expect(await fieldValues(fixture, "origin")).toEqual(["value-a-occurrence", "value-b-occurrence"]);
    expect(await fieldValues(fixture, "review")).toEqual(["value-b-occurrence"]);

    const review = await fixture.workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in review)) {
      throw new Error("Expected Field Value deletion Review Hunk");
    }
    const hunk = review.hunks.find(
      (candidate) =>
        candidate.diffSpace.kind === "child-sequence" &&
        candidate.evidence.effects.some(
          (effect) => effect.kind === "structure" && effect.occurrenceId === "value-a-occurrence",
        ),
    );
    if (!hunk) {
      throw new Error("Expected typed structure Hunk for the deleted Field Value");
    }
    expect(hunk.evidence.associatedImpactIds.length).toBeGreaterThan(0);
    expect(
      (
        await fixture.workspace.execute({
          kind: "resolve-review",
          workspaceId: "workspace",
          invocationId: "reject-value-delete",
          actorId: "reviewer",
          decision: "reject",
          selection: hunk.selection,
        })
      ).status,
    ).toBe("published");
    expect(await fieldValues(fixture, "origin")).toEqual(["value-a-occurrence", "value-b-occurrence"]);

    expect((await mutate(fixture, "delete-value-direct", [valueDeletion("value-a-occurrence")])).status).toBe(
      "published",
    );
    expect(await fieldValues(fixture, "origin")).toEqual(["value-b-occurrence"]);
    expect((await section(fixture, "origin", "nodes")).nodes["value-a"]).toBeDefined();
    expect((await section(fixture, "origin", "occurrences")).occurrences["value-a-occurrence"]).toBeUndefined();
    expect((await section(fixture, "origin", "nodeOwners")).nodeOwners["value-a"]).toBeUndefined();

    const history = await fixture.workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "desktop",
    });
    if (!("undo" in history) || !history.undo) {
      throw new Error("Expected Field Value deletion Undo");
    }
    const undone = await fixture.workspace.execute({
      kind: "undo",
      workspaceId: "workspace",
      invocationId: "undo-value-delete",
      actorId: "actor",
      selection: history.undo,
    });
    if (undone.status !== "published") {
      throw new Error(JSON.stringify(undone));
    }
    expect(undone).toMatchObject({ status: "published" });
    expect(await fieldValues(fixture, "origin")).toEqual(["value-a-occurrence", "value-b-occurrence"]);

    expect((await mutate(fixture, "delete-whole-field-direct", [materializedFieldDeletion()])).status).toBe(
      "published",
    );
    const fieldHistory = await fixture.workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "desktop",
    });
    if (!("undo" in fieldHistory) || !fieldHistory.undo) {
      throw new Error("Expected whole Field deletion Undo");
    }
    expect(
      (
        await fixture.workspace.execute({
          kind: "undo",
          workspaceId: "workspace",
          invocationId: "undo-whole-field-delete",
          actorId: "actor",
          selection: fieldHistory.undo,
        })
      ).status,
    ).toBe("published");
    expect(await fieldValues(fixture, "origin")).toEqual(["value-a-occurrence", "value-b-occurrence"]);
  });

  it("accepts Materialized Field clearing without destroying its detached content", async () => {
    const documents = new InMemoryDocumentStore();
    const fixture = await open(documents, "701");
    expect((await mutate(fixture, "setup-field", explicitFieldProgram())).status).toBe("published");
    expect((await mutate(fixture, "propose-field-delete", [materializedFieldDeletion()], "proposal")).status).toBe(
      "published",
    );
    expect(await materializedField(fixture, "origin")).toBeDefined();
    expect(await materializedField(fixture, "review")).toBeUndefined();

    const review = await fixture.workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in review)) {
      throw new Error("Expected Materialized Field deletion Review Hunk");
    }
    const hunk = review.hunks.find((candidate) => candidate.diffSpace.kind === "materialized-field");
    if (!hunk) {
      throw new Error("Expected typed Materialized Field Hunk");
    }
    expect(hunk.evidence.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "field-materialization",
          ownerNodeId: "owner",
          fieldDefinitionId: "field-definition",
          originFieldNodeId: FIELD_NODE_ID,
          reviewFieldNodeId: null,
        }),
      ]),
    );
    expect(
      (
        await fixture.workspace.execute({
          kind: "resolve-review",
          workspaceId: "workspace",
          invocationId: "accept-field-delete",
          actorId: "reviewer",
          decision: "accept",
          selection: hunk.selection,
        })
      ).status,
    ).toBe("published");
    await expectDeletedFieldState(fixture);

    await fixture.workspace.close();
    const restarted = await open(documents, "702");
    await expectDeletedFieldState(restarted);
    expect((await section(restarted, "origin", "nodes")).nodes[FIELD_NODE_ID]).toBeDefined();
  });
});

function explicitFieldProgram(): readonly EditAction[] {
  return [
    nodeAt("owner", "workspace", "owner-occurrence"),
    nodeAt("field-definition", "workspace", "field-definition-original", { intrinsicNodeType: "field-definition" }),
    nodeAt(FIELD_NODE_ID, "owner", FIELD_OCCURRENCE_ID),
    nodeAt("value-a", FIELD_NODE_ID, "value-a-occurrence"),
    nodeAt("value-b", FIELD_NODE_ID, "value-b-occurrence"),
    {
      kind: "field-materialize",
      ownerNodeId: "owner",
      fieldDefinitionId: "field-definition",
    },
  ];
}

function valueDeletion(valueOccurrenceId: string): EditAction {
  return {
    kind: "field-value-remove",
    valuePlacementId: valueOccurrenceId,
  };
}

function materializedFieldDeletion(): EditAction {
  return {
    kind: "materialized-field-clear",
    ownerNodeId: "owner",
    fieldDefinitionId: "field-definition",
  };
}

async function expectDeletedFieldState(fixture: WorkspaceFixture): Promise<void> {
  expect(await materializedField(fixture, "origin")).toBeUndefined();
  const nodes = (await section(fixture, "origin", "nodes")).nodes;
  expect(nodes[FIELD_NODE_ID]).toBeDefined();
  expect(nodes["value-a"]).toBeDefined();
  expect(nodes["value-b"]).toBeDefined();
  const owners = (await section(fixture, "origin", "nodeOwners")).nodeOwners;
  expect((await section(fixture, "origin", "occurrences")).occurrences[FIELD_OCCURRENCE_ID]).toBeUndefined();
  expect(owners[FIELD_NODE_ID]).toBeUndefined();
  expect(owners["value-a"]).toBe(FIELD_NODE_ID);
  expect(owners["value-b"]).toBe(FIELD_NODE_ID);
}

async function fieldValues(fixture: WorkspaceFixture, perspective: ProjectionPerspective): Promise<readonly string[]> {
  return (await materializedField(fixture, perspective))?.valueOccurrenceIds ?? [];
}

async function materializedField(fixture: WorkspaceFixture, perspective: ProjectionPerspective) {
  return (await section(fixture, perspective, "materializedFields")).materializedFields.owner?.[0];
}

async function mutate(
  fixture: WorkspaceFixture,
  invocationId: string,
  actions: readonly EditAction[],
  intent: "direct" | "proposal" = "direct",
) {
  return fixture.workspace.execute({
    kind: "edit",
    workspaceId: "workspace",
    invocationId,
    actorId: "actor",
    intent,
    historyChannelId: "desktop",
    actions,
  });
}

type WorkspaceFixture = Awaited<ReturnType<typeof open>>;

async function open(documents: InMemoryDocumentStore, loroPeerId: `${number}`) {
  const facts = await FactAuthority.open({
    workspaceId: "workspace",
    loroPeerId,
    documents: documents,
  });
  return {
    facts,
    workspace: await openTestWorkspace({ workspaceId: "workspace", facts, versions }),
  };
}

async function section<S extends ProjectionPage["section"]>(
  fixture: WorkspaceFixture,
  perspective: ProjectionPerspective,
  requested: S,
): Promise<ProjectionPage & Readonly<{ section: S }>> {
  const result = await fixture.workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective,
    section: requested,
  });
  if (!("section" in result) || result.section !== requested) {
    throw new Error(`Expected ${requested} Projection`);
  }
  return result as ProjectionPage & Readonly<{ section: S }>;
}
