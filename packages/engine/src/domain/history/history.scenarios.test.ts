import { describe, expect, it } from "vitest";

import { projectionText } from "../../../tests/support/reconcile/projection.js";
import { textAtoms } from "../reconcile/index.js";
import { queryReview } from "../review/index.js";
import { queryHistory, validateHistorySelection } from "./history.js";
import { rebuildHistoryState } from "./state.js";
import { baseFixture, end, HistoryFixture } from "../../../tests/support/history/history-test-helpers.js";

describe("production History scenarios", () => {
  it("History selection 与 redo branch", () => {
    const fixture = baseFixture();
    fixture.step({
      invocationId: "normal",
      mutations: [{ kind: "text-splice", nodeId: "node", deleteAtomIds: [], anchor: end, insert: "A" }],
    });
    const undoSelection = queryHistory("channel", fixture.receipts, fixture.snapshot(), fixture.generation()).undo!;
    const undoPlan = validateHistorySelection(
      undoSelection,
      "actor",
      fixture.receipts,
      fixture.snapshot(),
      fixture.generation(),
    );
    if (undoPlan.kind !== "ready") {
      throw new Error("Undo must be ready");
    }
    fixture.step({
      invocationId: "undo",
      operation: "undo",
      targetStepId: "normal",
      mutations: undoPlan.write.bodies.map((body) => body.mutation),
    });
    expect(rebuildHistoryState(fixture.receipts, "channel").redoStack).toEqual(["undo"]);

    const redoSelection = queryHistory("channel", fixture.receipts, fixture.snapshot(), fixture.generation()).redo!;
    const redoPlan = validateHistorySelection(
      redoSelection,
      "actor",
      fixture.receipts,
      fixture.snapshot(),
      fixture.generation(),
    );
    if (redoPlan.kind !== "ready") {
      throw new Error("Redo must be ready");
    }
    fixture.step({
      invocationId: "redo",
      operation: "redo",
      targetStepId: "undo",
      mutations: redoPlan.write.bodies.map((body) => body.mutation),
    });
    expect(projectionText(fixture.generation().origin, "node")).toBe("A");

    fixture.step({
      invocationId: "branch",
      mutations: [{ kind: "text-splice", nodeId: "node", deleteAtomIds: [], anchor: end, insert: "B" }],
    });
    expect(rebuildHistoryState(fixture.receipts, "channel").redoStack).toEqual([]);
  });

  it("partially superseded replacement restores only the still-attributable side", () => {
    const fixture = baseFixture();
    const initial = fixture.fact({
      kind: "text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      deletedAtoms: [],
      anchor: end,
      insert: "AB",
    });
    const replacement = fixture.step({
      invocationId: "replace",
      mutations: [
        {
          kind: "text-splice",
          nodeId: "node",
          deleteAtomIds: [`${initial.id}#0`, `${initial.id}#1`],
          deletedAtoms: [
            { id: `${initial.id}#0`, value: "A", attributes: {} },
            { id: `${initial.id}#1`, value: "B", attributes: {} },
          ],
          anchor: end,
          insert: "XY",
        },
      ],
    });
    const replacementFactId = replacement.factIds[0];
    fixture.fact({
      kind: "text-splice",
      nodeId: "node",
      deleteAtomIds: [`${replacementFactId}#0`],
      deletedAtoms: [{ id: `${replacementFactId}#0`, value: "X", attributes: {} }],
      anchor: {
        after: null,
        before: `${replacementFactId}#1`,
        affinity: "before",
        fallback: "start",
      },
      insert: "Z",
    });
    const selection = queryHistory("channel", fixture.receipts, fixture.snapshot(), fixture.generation()).undo!;
    const plan = validateHistorySelection(
      selection,
      "actor",
      fixture.receipts,
      fixture.snapshot(),
      fixture.generation(),
    );
    if (plan.kind !== "ready") {
      throw new Error("Partial replacement must be compensable");
    }
    fixture.step({
      invocationId: "replace-undo",
      operation: "undo",
      targetStepId: "replace",
      mutations: plan.write.bodies.map((body) => body.mutation),
    });
    expect(projectionText(fixture.generation().origin, "node")).toBe("ZB");
  });

  it("History sees contingent Direct effects", () => {
    const contingent = new HistoryFixture();
    contingent.fact({ kind: "node-create", nodeId: "proposal-node" }, "proposal");
    contingent.fact(
      {
        kind: "node-owner-set",
        nodeId: "proposal-node",
        ownerNodeId: "workspace",
        previousOwnerNodeId: null,
      },
      "proposal",
    );
    contingent.fact(
      {
        kind: "occurrence-create",
        occurrenceId: "proposal-node-original",
        nodeId: "proposal-node",
        parentNodeId: "workspace",
        anchor: end,
      },
      "proposal",
    );
    contingent.step({
      invocationId: "direct-on-proposal",
      mutations: [
        {
          kind: "text-splice",
          nodeId: "proposal-node",
          deleteAtomIds: [],
          deletedAtoms: [],
          anchor: end,
          insert: "X",
        },
      ],
    });
    expect(
      queryHistory("channel", contingent.receipts, contingent.snapshot(), contingent.generation()).undo?.evidence
        .compensations,
    ).toHaveLength(1);
  });

  it("Text 与 mark compensation", () => {
    const fixture = baseFixture();
    const inserted = fixture.step({
      invocationId: "text",
      mutations: [
        {
          kind: "text-splice",
          nodeId: "node",
          deleteAtomIds: [],
          deletedAtoms: [],
          anchor: end,
          insert: "AB",
        },
      ],
    });
    const firstFactId = inserted.factIds[0];
    fixture.fact({
      kind: "text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      deletedAtoms: [],
      anchor: {
        after: `${firstFactId}#0`,
        before: `${firstFactId}#1`,
        affinity: "after",
        fallback: "end",
      },
      insert: "X",
    });
    const selection = queryHistory("channel", fixture.receipts, fixture.snapshot(), fixture.generation()).undo!;
    const plan = validateHistorySelection(
      selection,
      "actor",
      fixture.receipts,
      fixture.snapshot(),
      fixture.generation(),
    );
    if (plan.kind !== "ready") {
      throw new Error("Text Undo must be ready");
    }
    fixture.step({
      invocationId: "undo",
      operation: "undo",
      targetStepId: "text",
      mutations: plan.write.bodies.map((body) => body.mutation),
    });
    expect(projectionText(fixture.generation().origin, "node")).toBe("X");

    const marks = baseFixture();
    const text = marks.fact({
      kind: "text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      deletedAtoms: [],
      anchor: end,
      insert: "AB",
    });
    marks.step({
      invocationId: "mark",
      mutations: [
        {
          kind: "text-mark",
          nodeId: "node",
          atomIds: [`${text.id}#0`, `${text.id}#1`],
          key: "bold",
          value: { kind: "set", value: true },
          previous: { kind: "unset" },
        },
      ],
    });
    marks.fact({
      kind: "text-mark",
      nodeId: "node",
      atomIds: [`${text.id}#0`],
      key: "bold",
      value: { kind: "set", value: false },
      previous: { kind: "set", value: true },
    });
    expect(
      queryHistory("channel", marks.receipts, marks.snapshot(), marks.generation()).undo?.evidence.compensations[0],
    ).toMatchObject({
      kind: "text-mark",
      atomIds: [`${text.id}#1`],
      value: { kind: "unset" },
    });

    const nullableMark = baseFixture();
    const nullableText = nullableMark.fact({
      kind: "text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      deletedAtoms: [],
      anchor: end,
      insert: "N",
      attributes: { nullable: null },
    });
    nullableMark.step({
      invocationId: "nullable-mark",
      mutations: [
        {
          kind: "text-mark",
          nodeId: "node",
          atomIds: [`${nullableText.id}#0`],
          key: "nullable",
          value: { kind: "set", value: "changed" },
          previous: { kind: "set", value: null },
        },
      ],
    });
    const nullableUndo = queryHistory(
      "channel",
      nullableMark.receipts,
      nullableMark.snapshot(),
      nullableMark.generation(),
    ).undo!;
    const nullableUndoPlan = validateHistorySelection(
      nullableUndo,
      "actor",
      nullableMark.receipts,
      nullableMark.snapshot(),
      nullableMark.generation(),
    );
    if (nullableUndoPlan.kind !== "ready") {
      throw new Error("Nullable mark Undo must be ready");
    }
    nullableMark.step({
      invocationId: "nullable-undo",
      operation: "undo",
      targetStepId: "nullable-mark",
      mutations: nullableUndoPlan.write.bodies.map((body) => body.mutation),
    });
    expect(textAtoms(nullableMark.generation().origin.nodes.node)[0]?.attributes.nullable).toBeNull();
    const nullableRedo = queryHistory(
      "channel",
      nullableMark.receipts,
      nullableMark.snapshot(),
      nullableMark.generation(),
    ).redo!;
    const nullableRedoPlan = validateHistorySelection(
      nullableRedo,
      "actor",
      nullableMark.receipts,
      nullableMark.snapshot(),
      nullableMark.generation(),
    );
    if (nullableRedoPlan.kind !== "ready") {
      throw new Error("Nullable mark Redo must be ready");
    }
    nullableMark.step({
      invocationId: "nullable-redo",
      operation: "redo",
      targetStepId: "nullable-undo",
      mutations: nullableRedoPlan.write.bodies.map((body) => body.mutation),
    });
    expect(textAtoms(nullableMark.generation().origin.nodes.node)[0]?.attributes.nullable).toBe("changed");

    const deletion = baseFixture();
    const initial = deletion.fact({
      kind: "text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      deletedAtoms: [],
      anchor: end,
      insert: "A",
    });
    deletion.step({
      invocationId: "delete-text",
      mutations: [
        {
          kind: "text-splice",
          nodeId: "node",
          deleteAtomIds: [`${initial.id}#0`],
          deletedAtoms: [{ id: `${initial.id}#0`, value: "A", attributes: {} }],
          anchor: end,
          insert: "",
        },
      ],
    });
    deletion.fact({
      kind: "text-splice",
      nodeId: "node",
      deleteAtomIds: [`${initial.id}#0`],
      deletedAtoms: [{ id: `${initial.id}#0`, value: "A", attributes: {} }],
      anchor: end,
      insert: "",
    });
    expect(queryHistory("channel", deletion.receipts, deletion.snapshot(), deletion.generation()).undo).toBeNull();

    const richDeletion = baseFixture();
    const richText = richDeletion.fact({
      kind: "text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      deletedAtoms: [],
      anchor: end,
      insert: "AB",
    });
    richDeletion.fact({
      kind: "text-mark",
      nodeId: "node",
      atomIds: [`${richText.id}#1`],
      key: "bold",
      value: { kind: "set", value: true },
      previous: { kind: "unset" },
    });
    richDeletion.step({
      invocationId: "rich-delete",
      mutations: [
        {
          kind: "text-splice",
          nodeId: "node",
          deleteAtomIds: [`${richText.id}#0`, `${richText.id}#1`],
          deletedAtoms: [
            { id: `${richText.id}#0`, value: "A", attributes: {} },
            { id: `${richText.id}#1`, value: "B", attributes: { bold: true } },
          ],
          anchor: end,
          insert: "",
        },
      ],
    });
    const richUndo = queryHistory(
      "channel",
      richDeletion.receipts,
      richDeletion.snapshot(),
      richDeletion.generation(),
    ).undo;
    if (!richUndo) {
      throw new Error("Mixed rich-text deletion must be compensable");
    }
    expect(richUndo.evidence.compensations).toHaveLength(2);
    richDeletion.step({
      invocationId: "rich-undo",
      operation: "undo",
      targetStepId: "rich-delete",
      mutations: richUndo.evidence.compensations,
    });
    expect(projectionText(richDeletion.generation().origin, "node")).toBe("AB");
    expect(textAtoms(richDeletion.generation().origin.nodes.node)[1]?.attributes).toEqual({
      bold: true,
    });

    const replaced = baseFixture();
    const original = replaced.fact({
      kind: "text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      deletedAtoms: [],
      anchor: end,
      insert: "A",
    });
    const replacement = replaced.step({
      invocationId: "replace",
      mutations: [
        {
          kind: "text-splice",
          nodeId: "node",
          deleteAtomIds: [`${original.id}#0`],
          deletedAtoms: [{ id: `${original.id}#0`, value: "A", attributes: {} }],
          anchor: end,
          insert: "X",
        },
      ],
    });
    replaced.fact({
      kind: "text-splice",
      nodeId: "node",
      deleteAtomIds: [`${replacement.factIds[0]}#0`],
      deletedAtoms: [{ id: `${replacement.factIds[0]}#0`, value: "X", attributes: {} }],
      anchor: end,
      insert: "Y",
    });
    expect(projectionText(replaced.generation().origin, "node")).toBe("Y");
    expect(queryHistory("channel", replaced.receipts, replaced.snapshot(), replaced.generation()).undo).toBeNull();
  });

  it("Create/Delete/Move/Canonical compensation", () => {
    const nodeCreate = new HistoryFixture();
    nodeCreate.step({
      invocationId: "node-create",
      mutations: [
        { kind: "node-create", nodeId: "created" },
        {
          kind: "occurrence-create",
          occurrenceId: "created-original",
          nodeId: "created",
          parentNodeId: "workspace",
          anchor: end,
        },
      ],
    });
    expect(
      queryHistory("channel", nodeCreate.receipts, nodeCreate.snapshot(), nodeCreate.generation()).undo?.evidence
        .compensations,
    ).toEqual([
      { kind: "node-delete", nodeId: "created" },
      {
        kind: "node-owner-set",
        nodeId: "created",
        ownerNodeId: "workspace-trash:v1:workspace",
        previousOwnerNodeId: "workspace",
      },
      {
        kind: "occurrence-move",
        occurrenceId: "created-original",
        parentNodeId: "workspace-trash:v1:workspace",
        anchor: end,
        previousParentNodeId: "workspace",
        previousAnchor: {
          after: "workspace-trash-occ:v1:workspace",
          before: null,
          affinity: "after",
          fallback: "end",
        },
      },
    ]);

    const duplicateNodeCreate = new HistoryFixture();
    duplicateNodeCreate.step({
      invocationId: "node-create",
      mutations: [
        { kind: "node-create", nodeId: "created" },
        {
          kind: "occurrence-create",
          occurrenceId: "created-original",
          nodeId: "created",
          parentNodeId: "workspace",
          anchor: end,
        },
      ],
    });
    duplicateNodeCreate.fact({ kind: "node-create", nodeId: "created" });
    expect(
      queryHistory(
        "channel",
        duplicateNodeCreate.receipts,
        duplicateNodeCreate.snapshot(),
        duplicateNodeCreate.generation(),
      ).undo,
    ).toBeNull();
    const occurrenceCreate = new HistoryFixture();
    occurrenceCreate.fact({ kind: "node-create", nodeId: "node" });
    occurrenceCreate.step({
      invocationId: "occurrence-create",
      mutations: [
        {
          kind: "occurrence-create",
          occurrenceId: "created-occurrence",
          nodeId: "node",
          parentNodeId: "workspace",
          anchor: end,
        },
      ],
    });
    expect(
      queryHistory("channel", occurrenceCreate.receipts, occurrenceCreate.snapshot(), occurrenceCreate.generation())
        .undo?.evidence.compensations[0],
    ).toMatchObject({
      kind: "occurrence-delete",
      occurrenceId: "created-occurrence",
    });
    const fixture = baseFixture();
    const deletion = fixture.step({
      invocationId: "delete",
      mutations: [{ kind: "node-delete", nodeId: "node" }],
    });
    const selection = queryHistory("channel", fixture.receipts, fixture.snapshot(), fixture.generation()).undo!;
    expect(selection.evidence.compensations).toEqual(
      expect.arrayContaining([
        {
          kind: "node-restore",
          nodeId: "node",
          deletionFactId: deletion.factIds[0],
        },
        expect.objectContaining({
          kind: "node-owner-set",
          nodeId: "node",
          ownerNodeId: "workspace",
        }),
        expect.objectContaining({
          kind: "occurrence-move",
          occurrenceId: "occurrence",
          parentNodeId: "workspace",
        }),
      ]),
    );
    fixture.fact({ kind: "node-delete", nodeId: "node" });
    expect(queryHistory("channel", fixture.receipts, fixture.snapshot(), fixture.generation()).undo).toBeNull();

    const restoredIndependentDelete = baseFixture();
    const targetDelete = restoredIndependentDelete.step({
      invocationId: "target-delete",
      mutations: [{ kind: "node-delete", nodeId: "node" }],
    });
    const independentDelete = restoredIndependentDelete.fact({
      kind: "node-delete",
      nodeId: "node",
    });
    restoredIndependentDelete.fact({
      kind: "node-restore",
      nodeId: "node",
      deletionFactId: independentDelete.id,
    });
    expect(
      queryHistory(
        "channel",
        restoredIndependentDelete.receipts,
        restoredIndependentDelete.snapshot(),
        restoredIndependentDelete.generation(),
      ).undo?.evidence.compensations,
    ).toEqual(
      expect.arrayContaining([
        {
          kind: "node-restore",
          nodeId: "node",
          deletionFactId: targetDelete.factIds[0],
        },
        expect.objectContaining({ kind: "node-owner-set", nodeId: "node", ownerNodeId: "workspace" }),
        expect.objectContaining({ kind: "occurrence-move", occurrenceId: "occurrence", parentNodeId: "workspace" }),
      ]),
    );

    const occurrenceDelete = baseFixture();
    const deletedOccurrence = occurrenceDelete.step({
      invocationId: "occurrence-delete",
      mutations: [
        {
          kind: "occurrence-delete",
          occurrenceId: "occurrence",
          previousParentNodeId: "workspace",
          previousAnchor: end,
        },
      ],
    });
    const occurrenceDeletionFactId = deletedOccurrence.factIds[0];
    if (!occurrenceDeletionFactId) {
      throw new Error("Occurrence deletion must commit one Fact");
    }
    expect(
      queryHistory("channel", occurrenceDelete.receipts, occurrenceDelete.snapshot(), occurrenceDelete.generation())
        .undo?.evidence.compensations[0],
    ).toEqual({
      kind: "occurrence-restore",
      occurrenceId: "occurrence",
      deletionFactId: occurrenceDeletionFactId,
      parentNodeId: "workspace",
      anchor: end,
    });
    occurrenceDelete.step({
      invocationId: "occurrence-restore",
      mutations: [
        {
          kind: "occurrence-restore",
          occurrenceId: "occurrence",
          deletionFactId: occurrenceDeletionFactId,
          parentNodeId: "workspace",
          anchor: end,
        },
      ],
    });
    expect(
      queryHistory("channel", occurrenceDelete.receipts, occurrenceDelete.snapshot(), occurrenceDelete.generation())
        .undo?.evidence.compensations[0],
    ).toMatchObject({
      kind: "occurrence-delete",
      occurrenceId: "occurrence",
    });
    occurrenceDelete.fact({
      kind: "occurrence-restore",
      occurrenceId: "occurrence",
      deletionFactId: occurrenceDeletionFactId,
      parentNodeId: "workspace",
      anchor: end,
    });
    expect(
      queryHistory("channel", occurrenceDelete.receipts, occurrenceDelete.snapshot(), occurrenceDelete.generation())
        .undo,
    ).toBeNull();

    const neutralLaterMove = new HistoryFixture();
    neutralLaterMove.fact({ kind: "node-create", nodeId: "parent" });
    neutralLaterMove.fact({
      kind: "occurrence-create",
      occurrenceId: "parent",
      nodeId: "parent",
      parentNodeId: "workspace",
      anchor: end,
    });
    neutralLaterMove.fact({ kind: "node-create", nodeId: "child" });
    neutralLaterMove.fact({
      kind: "occurrence-create",
      occurrenceId: "child",
      nodeId: "child",
      parentNodeId: "parent",
      anchor: end,
    });
    neutralLaterMove.step({
      invocationId: "move",
      mutations: [
        {
          kind: "occurrence-move",
          occurrenceId: "child",
          parentNodeId: "workspace",
          anchor: end,
          previousParentNodeId: "parent",
          previousAnchor: end,
        },
      ],
    });
    neutralLaterMove.fact({
      kind: "occurrence-move",
      occurrenceId: "child",
      parentNodeId: "child",
      anchor: end,
      previousParentNodeId: "workspace",
      previousAnchor: end,
    });
    expect(
      queryHistory("channel", neutralLaterMove.receipts, neutralLaterMove.snapshot(), neutralLaterMove.generation())
        .undo,
    ).toBeNull();

    const move = baseFixture();
    move.fact({ kind: "node-create", nodeId: "parent" });
    move.fact({
      kind: "occurrence-create",
      occurrenceId: "parent",
      nodeId: "parent",
      parentNodeId: "workspace",
      anchor: end,
    });
    move.step({
      invocationId: "move",
      mutations: [
        {
          kind: "occurrence-move",
          occurrenceId: "occurrence",
          parentNodeId: "parent",
          anchor: end,
          previousParentNodeId: "workspace",
          previousAnchor: end,
        },
      ],
    });
    expect(
      queryHistory("channel", move.receipts, move.snapshot(), move.generation()).undo?.evidence.compensations[0],
    ).toMatchObject({
      kind: "occurrence-move",
      parentNodeId: "workspace",
    });
    move.fact({
      kind: "occurrence-move",
      occurrenceId: "occurrence",
      parentNodeId: "parent",
      anchor: { ...end, fallback: "start" },
      previousParentNodeId: "parent",
      previousAnchor: end,
    });
    expect(queryHistory("channel", move.receipts, move.snapshot(), move.generation()).undo).toBeNull();

    const missingDeleteParent = new HistoryFixture();
    missingDeleteParent.fact({ kind: "node-create", nodeId: "parent-node" });
    missingDeleteParent.fact({
      kind: "occurrence-create",
      occurrenceId: "parent",
      nodeId: "parent-node",
      parentNodeId: "workspace",
      anchor: end,
    });
    missingDeleteParent.fact({ kind: "node-create", nodeId: "child-node" });
    missingDeleteParent.fact({
      kind: "occurrence-create",
      occurrenceId: "child",
      nodeId: "child-node",
      parentNodeId: "parent",
      anchor: end,
    });
    missingDeleteParent.step({
      invocationId: "delete-child",
      mutations: [
        {
          kind: "occurrence-delete",
          occurrenceId: "child",
          previousParentNodeId: "parent",
          previousAnchor: end,
        },
      ],
    });
    missingDeleteParent.fact({
      kind: "occurrence-delete",
      occurrenceId: "parent",
      previousParentNodeId: "workspace",
      previousAnchor: end,
    });
    expect(
      queryHistory(
        "channel",
        missingDeleteParent.receipts,
        missingDeleteParent.snapshot(),
        missingDeleteParent.generation(),
      ).undo,
    ).toBeNull();

    const missingMoveParent = new HistoryFixture();
    missingMoveParent.facts.push(...missingDeleteParent.facts.slice(0, 4));
    missingMoveParent.step({
      invocationId: "move-child",
      mutations: [
        {
          kind: "occurrence-move",
          occurrenceId: "child",
          parentNodeId: "workspace",
          anchor: end,
          previousParentNodeId: "parent",
          previousAnchor: end,
        },
      ],
    });
    missingMoveParent.fact({
      kind: "occurrence-delete",
      occurrenceId: "parent",
      previousParentNodeId: "workspace",
      previousAnchor: end,
    });
    expect(
      queryHistory("channel", missingMoveParent.receipts, missingMoveParent.snapshot(), missingMoveParent.generation())
        .undo,
    ).toBeNull();

    const canonical = baseFixture();
    canonical.fact({ kind: "node-create", nodeId: "reference-parent" });
    canonical.fact({
      kind: "occurrence-create",
      occurrenceId: "reference-parent-original",
      nodeId: "reference-parent",
      parentNodeId: "workspace",
      anchor: end,
    });
    canonical.fact({
      kind: "occurrence-create",
      occurrenceId: "reference",
      nodeId: "node",
      parentNodeId: "reference-parent",
      anchor: end,
    });
    canonical.step({
      invocationId: "canonical",
      mutations: [
        {
          kind: "node-owner-set",
          nodeId: "node",
          ownerNodeId: "reference-parent",
          previousOwnerNodeId: "workspace",
        },
      ],
    });
    expect(
      queryHistory("channel", canonical.receipts, canonical.snapshot(), canonical.generation()).undo?.evidence
        .compensations[0],
    ).toMatchObject({
      kind: "node-owner-set",
      ownerNodeId: "workspace",
    });
    canonical.fact({
      kind: "node-owner-set",
      nodeId: "node",
      ownerNodeId: "reference-parent",
      previousOwnerNodeId: "reference-parent",
    });
    expect(queryHistory("channel", canonical.receipts, canonical.snapshot(), canonical.generation()).undo).toBeNull();
  });

  it("Proposal Redo restores Review work after net-zero Undo", () => {
    const fixture = baseFixture();
    fixture.step({
      invocationId: "proposal",
      intent: "proposal",
      mutations: [{ kind: "text-splice", nodeId: "node", deleteAtomIds: [], anchor: end, insert: "proposal" }],
    });
    const selection = queryHistory("channel", fixture.receipts, fixture.snapshot(), fixture.generation()).undo!;
    const plan = validateHistorySelection(
      selection,
      "actor",
      fixture.receipts,
      fixture.snapshot(),
      fixture.generation(),
    );
    if (plan.kind !== "ready") {
      throw new Error("Proposal Undo must be ready");
    }
    fixture.step({
      invocationId: "proposal-undo",
      intent: "proposal",
      operation: "undo",
      targetStepId: "proposal",
      mutations: plan.write.bodies.map((body) => body.mutation),
    });
    const redo = queryHistory("channel", fixture.receipts, fixture.snapshot(), fixture.generation()).redo;
    if (!redo) {
      throw new Error("Proposal Redo selection must exist");
    }
    const redoPlan = validateHistorySelection(
      redo,
      "actor",
      fixture.receipts,
      fixture.snapshot(),
      fixture.generation(),
    );
    if (redoPlan.kind !== "ready") {
      throw new Error("Proposal Redo must be ready");
    }
    fixture.step({
      invocationId: "proposal-redo",
      intent: "proposal",
      operation: "redo",
      targetStepId: "proposal-undo",
      mutations: redoPlan.write.bodies.map((body) => body.mutation),
    });
    expect(queryReview("workspace", fixture.snapshot(), fixture.generation()).hunks.length).toBeGreaterThan(0);
  });
});
