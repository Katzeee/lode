import { describe, expect, it } from "vitest";

import { projectionText } from "../../../tests/support/reconcile/projection.js";
import { textAtoms } from "../reconcile/index.js";
import { queryReview } from "../review/index.js";
import { factActionId, type FactActionId, type FactId } from "../fact/index.js";
import { queryHistory, validateHistorySelection } from "./history.js";
import { rebuildHistoryState } from "./state.js";
import { baseFixture, end, HistoryFixture } from "../../../tests/support/history/history-test-helpers.js";

describe("production History scenarios", () => {
  it("History selection 与 redo branch", () => {
    const fixture = baseFixture();
    fixture.step({
      invocationId: "normal",
      actions: [{ kind: "rich-text-splice", nodeId: "node", deleteAtomIds: [], anchor: end, insert: "A" }],
    });
    const undoSelection = queryHistory("channel", fixture.snapshot()).undo!;
    const undoPlan = validateHistorySelection("undo", undoSelection, fixture.snapshot(), fixture.generation());
    if (undoPlan.kind !== "ready") {
      throw new Error("Undo must be ready");
    }
    fixture.step({
      invocationId: "undo",
      operation: "undo",
      targetStepId: "normal",
      actions: undoPlan.writes.flatMap((batch) => batch.actions),
    });
    expect(rebuildHistoryState(fixture.snapshot(), "channel").redoStack).toEqual([fixture.stepId("undo")]);

    const redoSelection = queryHistory("channel", fixture.snapshot()).redo!;
    const redoPlan = validateHistorySelection("redo", redoSelection, fixture.snapshot(), fixture.generation());
    if (redoPlan.kind !== "ready") {
      throw new Error("Redo must be ready");
    }
    fixture.step({
      invocationId: "redo",
      operation: "redo",
      targetStepId: "undo",
      actions: redoPlan.writes.flatMap((batch) => batch.actions),
    });
    expect(projectionText(fixture.generation().origin, "node")).toBe("A");

    fixture.step({
      invocationId: "branch",
      actions: [{ kind: "rich-text-splice", nodeId: "node", deleteAtomIds: [], anchor: end, insert: "B" }],
    });
    expect(rebuildHistoryState(fixture.snapshot(), "channel").redoStack).toEqual([]);
  });

  it("compensates only the part of a step that remains attributable", () => {
    const fixture = baseFixture();
    const initial = fixture.fact({
      kind: "rich-text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      anchor: end,
      insert: "AB",
    });
    const replacement = fixture.step({
      invocationId: "replace",
      actions: [
        {
          kind: "rich-text-splice",
          nodeId: "node",
          deleteAtomIds: [`${initial.id}#0`, `${initial.id}#1`],
          anchor: end,
          insert: "XY",
        },
      ],
    });
    const replacementActionId = receiptActionId(replacement.factIds[0]);
    fixture.fact({
      kind: "rich-text-splice",
      nodeId: "node",
      deleteAtomIds: [`${replacementActionId}#0`],
      anchor: {
        after: null,
        before: `${replacementActionId}#1`,
        affinity: "before",
        fallback: "start",
      },
      insert: "Z",
    });
    const selection = queryHistory("channel", fixture.snapshot()).undo!;
    const plan = validateHistorySelection("undo", selection, fixture.snapshot(), fixture.generation());
    if (plan.kind !== "ready") {
      throw new Error("Remaining attributable text must be compensable");
    }
    fixture.step({
      invocationId: "undo-replace",
      operation: "undo",
      targetStepId: "replace",
      actions: plan.writes.flatMap((batch) => batch.actions),
    });
    expect(projectionText(fixture.generation().origin, "node")).toBe("ZB");
  });

  it("History sees contingent Direct effects", () => {
    const contingent = new HistoryFixture();
    contingent.fact(
      {
        kind: "node-create",
        nodeId: "proposal-node",
        ownerNodeId: "workspace",
        originalPlacement: { placementId: "proposal-node-original", anchor: end },
      },
      "proposal",
    );
    contingent.step({
      invocationId: "direct-on-proposal",
      actions: [
        {
          kind: "rich-text-splice",
          nodeId: "proposal-node",
          deleteAtomIds: [],
          anchor: end,
          insert: "X",
        },
      ],
    });
    expect(contingent.compensationActions("direct-on-proposal")).toHaveLength(1);
  });

  it("Text 与 mark compensation", () => {
    const fixture = baseFixture();
    const inserted = fixture.step({
      invocationId: "text",
      actions: [
        {
          kind: "rich-text-splice",
          nodeId: "node",
          deleteAtomIds: [],
          anchor: end,
          insert: "AB",
        },
      ],
    });
    const firstActionId = receiptActionId(inserted.factIds[0]);
    fixture.fact({
      kind: "rich-text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      anchor: {
        after: `${firstActionId}#0`,
        before: `${firstActionId}#1`,
        affinity: "after",
        fallback: "end",
      },
      insert: "X",
    });
    const selection = queryHistory("channel", fixture.snapshot()).undo!;
    const plan = validateHistorySelection("undo", selection, fixture.snapshot(), fixture.generation());
    if (plan.kind !== "ready") {
      throw new Error("Text Undo must be ready");
    }
    fixture.step({
      invocationId: "undo",
      operation: "undo",
      targetStepId: "text",
      actions: plan.writes.flatMap((batch) => batch.actions),
    });
    expect(projectionText(fixture.generation().origin, "node")).toBe("X");

    const marks = baseFixture();
    const text = marks.fact({
      kind: "rich-text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      anchor: end,
      insert: "AB",
    });
    marks.step({
      invocationId: "mark",
      actions: [
        {
          kind: "rich-text-mark",
          nodeId: "node",
          atomIds: [`${text.id}#0`, `${text.id}#1`],
          key: "bold",
          value: { kind: "set", value: true },
        },
      ],
    });
    marks.fact({
      kind: "rich-text-mark",
      nodeId: "node",
      atomIds: [`${text.id}#0`],
      key: "bold",
      value: { kind: "set", value: false },
    });
    expect(marks.compensationActions("mark")[0]).toMatchObject({
      kind: "rich-text-mark",
      atomIds: [`${text.id}#1`],
      value: { kind: "unset" },
    });

    const nullableMark = baseFixture();
    const nullableText = nullableMark.fact({
      kind: "rich-text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      anchor: end,
      insert: "N",
      attributes: { nullable: null },
    });
    nullableMark.step({
      invocationId: "nullable-mark",
      actions: [
        {
          kind: "rich-text-mark",
          nodeId: "node",
          atomIds: [`${nullableText.id}#0`],
          key: "nullable",
          value: { kind: "set", value: "changed" },
        },
      ],
    });
    const nullableUndo = queryHistory("channel", nullableMark.snapshot()).undo!;
    const nullableUndoPlan = validateHistorySelection(
      "undo",
      nullableUndo,
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
      actions: nullableUndoPlan.writes.flatMap((batch) => batch.actions),
    });
    expect(textAtoms(nullableMark.generation().origin.nodes.node)[0]?.attributes.nullable).toBeNull();
    const nullableRedo = queryHistory("channel", nullableMark.snapshot()).redo!;
    const nullableRedoPlan = validateHistorySelection(
      "redo",
      nullableRedo,
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
      actions: nullableRedoPlan.writes.flatMap((batch) => batch.actions),
    });
    expect(textAtoms(nullableMark.generation().origin.nodes.node)[0]?.attributes.nullable).toBe("changed");

    const deletion = baseFixture();
    const initial = deletion.fact({
      kind: "rich-text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      anchor: end,
      insert: "A",
    });
    deletion.step({
      invocationId: "delete-text",
      actions: [
        {
          kind: "rich-text-splice",
          nodeId: "node",
          deleteAtomIds: [`${initial.id}#0`],
          anchor: end,
          insert: "",
        },
      ],
    });
    deletion.fact({
      kind: "rich-text-splice",
      nodeId: "node",
      deleteAtomIds: [`${initial.id}#0`],
      anchor: end,
      insert: "",
    });
    expectUndoUnavailable(deletion);

    const richDeletion = baseFixture();
    const richText = richDeletion.fact({
      kind: "rich-text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      anchor: end,
      insert: "AB",
    });
    richDeletion.fact({
      kind: "rich-text-mark",
      nodeId: "node",
      atomIds: [`${richText.id}#1`],
      key: "bold",
      value: { kind: "set", value: true },
    });
    richDeletion.step({
      invocationId: "rich-delete",
      actions: [
        {
          kind: "rich-text-splice",
          nodeId: "node",
          deleteAtomIds: [`${richText.id}#0`, `${richText.id}#1`],
          anchor: end,
          insert: "",
        },
      ],
    });
    const richUndo = queryHistory("channel", richDeletion.snapshot()).undo;
    if (!richUndo) {
      throw new Error("Mixed rich-text deletion must be compensable");
    }
    expect(richDeletion.compensationActions("rich-delete")).toHaveLength(2);
    richDeletion.step({
      invocationId: "rich-undo",
      operation: "undo",
      targetStepId: "rich-delete",
      actions: richDeletion.compensationActions("rich-delete"),
    });
    expect(projectionText(richDeletion.generation().origin, "node")).toBe("AB");
    expect(textAtoms(richDeletion.generation().origin.nodes.node)[1]?.attributes).toEqual({
      bold: true,
    });

    const replaced = baseFixture();
    const original = replaced.fact({
      kind: "rich-text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      anchor: end,
      insert: "A",
    });
    const replacement = replaced.step({
      invocationId: "replace",
      actions: [
        {
          kind: "rich-text-splice",
          nodeId: "node",
          deleteAtomIds: [`${original.id}#0`],
          anchor: end,
          insert: "X",
        },
      ],
    });
    replaced.fact({
      kind: "rich-text-splice",
      nodeId: "node",
      deleteAtomIds: [`${receiptActionId(replacement.factIds[0])}#0`],
      anchor: end,
      insert: "Y",
    });
    expect(projectionText(replaced.generation().origin, "node")).toBe("Y");
    expectUndoUnavailable(replaced);
  });

  it("Create/Delete/Move/Canonical compensation", () => {
    const nodeCreate = new HistoryFixture();
    nodeCreate.step({
      invocationId: "node-create",
      actions: [
        { kind: "node-create", nodeId: "created", ownerNodeId: "workspace", originalPlacement: null },
        {
          kind: "placement-create",
          placementId: "created-original",
          nodeId: "created",
          parentNodeId: "workspace",
          anchor: end,
        },
      ],
    });
    expect(nodeCreate.compensationActions("node-create")).toEqual([{ kind: "node-trash", nodeId: "created" }]);

    const duplicateNodeCreate = new HistoryFixture();
    duplicateNodeCreate.step({
      invocationId: "node-create",
      actions: [
        { kind: "node-create", nodeId: "created", ownerNodeId: "workspace", originalPlacement: null },
        {
          kind: "placement-create",
          placementId: "created-original",
          nodeId: "created",
          parentNodeId: "workspace",
          anchor: end,
        },
      ],
    });
    duplicateNodeCreate.fact({
      kind: "node-create",
      nodeId: "created",
      ownerNodeId: "workspace",
      originalPlacement: null,
    });
    expectUndoUnavailable(duplicateNodeCreate);
    const occurrenceCreate = new HistoryFixture();
    occurrenceCreate.fact({ kind: "node-create", nodeId: "node", ownerNodeId: "workspace", originalPlacement: null });
    occurrenceCreate.step({
      invocationId: "placement-create",
      actions: [
        {
          kind: "placement-create",
          placementId: "created-occurrence",
          nodeId: "node",
          parentNodeId: "workspace",
          anchor: end,
        },
      ],
    });
    expect(occurrenceCreate.compensationActions("placement-create")[0]).toMatchObject({
      kind: "placement-remove",
      placementId: "created-occurrence",
    });
    const fixture = baseFixture();
    const deletion = fixture.step({
      invocationId: "delete",
      actions: [{ kind: "node-trash", nodeId: "node" }],
    });
    expect(deletion.factIds).toHaveLength(1);
    expect(fixture.compensationActions("delete")).toEqual([
      {
        kind: "node-restore",
        nodeId: "node",
        placementId: "occurrence",
        parentNodeId: "workspace",
        anchor: {
          after: "workspace-trash-occ:v1:workspace",
          before: null,
          affinity: "after",
          fallback: "end",
        },
      },
    ]);
    fixture.fact({ kind: "node-trash", nodeId: "node" });
    expectUndoUnavailable(fixture);

    const restoredIndependentDelete = baseFixture();
    const targetDelete = restoredIndependentDelete.step({
      invocationId: "target-delete",
      actions: [{ kind: "node-trash", nodeId: "node" }],
    });
    const independentDelete = restoredIndependentDelete.fact({
      kind: "node-trash",
      nodeId: "node",
    });
    restoredIndependentDelete.fact({
      kind: "node-restore",
      nodeId: "node",
      placementId: "occurrence",
      parentNodeId: "workspace",
      anchor: end,
    });
    expect(independentDelete.action.kind).toBe("node-trash");
    expect(targetDelete.factIds).toHaveLength(1);
    expectUndoUnavailable(restoredIndependentDelete);

    const occurrenceDelete = baseFixture();
    occurrenceDelete.step({
      invocationId: "placement-remove",
      actions: [
        {
          kind: "placement-remove",
          placementId: "occurrence",
        },
      ],
    });
    expect(occurrenceDelete.compensationActions("placement-remove")[0]).toEqual({
      kind: "placement-create",
      placementId: "occurrence",
      nodeId: "node",
      parentNodeId: "workspace",
      anchor: {
        after: "workspace-trash-occ:v1:workspace",
        before: null,
        affinity: "after",
        fallback: "end",
      },
    });
    occurrenceDelete.step({
      invocationId: "placement-create",
      actions: [
        {
          kind: "placement-create",
          placementId: "occurrence",
          nodeId: "node",
          parentNodeId: "workspace",
          anchor: end,
        },
      ],
    });
    expect(occurrenceDelete.compensationActions("placement-create")[0]).toMatchObject({
      kind: "placement-remove",
      placementId: "occurrence",
    });
    occurrenceDelete.fact({
      kind: "placement-create",
      placementId: "occurrence",
      nodeId: "node",
      parentNodeId: "workspace",
      anchor: end,
    });
    expectUndoUnavailable(occurrenceDelete);

    const neutralLaterMove = new HistoryFixture();
    neutralLaterMove.fact({ kind: "node-create", nodeId: "parent", ownerNodeId: "workspace", originalPlacement: null });
    neutralLaterMove.fact({
      kind: "placement-create",
      placementId: "parent",
      nodeId: "parent",
      parentNodeId: "workspace",
      anchor: end,
    });
    neutralLaterMove.fact({ kind: "node-create", nodeId: "child", ownerNodeId: "workspace", originalPlacement: null });
    neutralLaterMove.fact({
      kind: "placement-create",
      placementId: "child",
      nodeId: "child",
      parentNodeId: "parent",
      anchor: end,
    });
    neutralLaterMove.step({
      invocationId: "move",
      actions: [
        {
          kind: "placement-move",
          placementId: "child",
          parentNodeId: "workspace",
          anchor: end,
        },
      ],
    });
    neutralLaterMove.fact({
      kind: "placement-move",
      placementId: "child",
      parentNodeId: "child",
      anchor: end,
    });
    expectUndoUnavailable(neutralLaterMove);

    const move = baseFixture();
    move.fact({ kind: "node-create", nodeId: "parent", ownerNodeId: "workspace", originalPlacement: null });
    move.fact({
      kind: "placement-create",
      placementId: "parent",
      nodeId: "parent",
      parentNodeId: "workspace",
      anchor: end,
    });
    move.step({
      invocationId: "move",
      actions: [
        {
          kind: "placement-move",
          placementId: "occurrence",
          parentNodeId: "parent",
          anchor: end,
        },
      ],
    });
    expect(move.compensationActions("move")[0]).toMatchObject({
      kind: "placement-move",
      parentNodeId: "workspace",
    });
    move.fact({
      kind: "placement-move",
      placementId: "occurrence",
      parentNodeId: "parent",
      anchor: { ...end, fallback: "start" },
    });
    expectUndoUnavailable(move);

    const missingDeleteParent = new HistoryFixture();
    missingDeleteParent.fact({
      kind: "node-create",
      nodeId: "parent-node",
      ownerNodeId: "workspace",
      originalPlacement: null,
    });
    missingDeleteParent.fact({
      kind: "placement-create",
      placementId: "parent",
      nodeId: "parent-node",
      parentNodeId: "workspace",
      anchor: end,
    });
    missingDeleteParent.fact({
      kind: "node-create",
      nodeId: "child-node",
      ownerNodeId: "workspace",
      originalPlacement: null,
    });
    missingDeleteParent.fact({
      kind: "placement-create",
      placementId: "child",
      nodeId: "child-node",
      parentNodeId: "parent",
      anchor: end,
    });
    missingDeleteParent.step({
      invocationId: "delete-child",
      actions: [
        {
          kind: "placement-remove",
          placementId: "child",
        },
      ],
    });
    missingDeleteParent.fact({
      kind: "placement-remove",
      placementId: "parent",
    });
    expectUndoUnavailable(missingDeleteParent);

    const missingMoveParent = new HistoryFixture();
    missingMoveParent.facts.push(...missingDeleteParent.facts.slice(0, 4));
    missingMoveParent.step({
      invocationId: "move-child",
      actions: [
        {
          kind: "placement-move",
          placementId: "child",
          parentNodeId: "workspace",
          anchor: end,
        },
      ],
    });
    missingMoveParent.fact({
      kind: "placement-remove",
      placementId: "parent",
    });
    expectUndoUnavailable(missingMoveParent);
  });

  it("Proposal Redo restores Review work after net-zero Undo", () => {
    const fixture = baseFixture();
    fixture.step({
      invocationId: "proposal",
      intent: "proposal",
      actions: [{ kind: "rich-text-splice", nodeId: "node", deleteAtomIds: [], anchor: end, insert: "proposal" }],
    });
    const selection = queryHistory("channel", fixture.snapshot()).undo!;
    const plan = validateHistorySelection("undo", selection, fixture.snapshot(), fixture.generation());
    if (plan.kind !== "ready") {
      throw new Error("Proposal Undo must be ready");
    }
    fixture.step({
      invocationId: "proposal-undo",
      intent: "proposal",
      operation: "undo",
      targetStepId: "proposal",
      actions: plan.writes.flatMap((batch) => batch.actions),
    });
    const redo = queryHistory("channel", fixture.snapshot()).redo;
    if (!redo) {
      throw new Error("Proposal Redo selection must exist");
    }
    const redoPlan = validateHistorySelection("redo", redo, fixture.snapshot(), fixture.generation());
    if (redoPlan.kind !== "ready") {
      throw new Error("Proposal Redo must be ready");
    }
    fixture.step({
      invocationId: "proposal-redo",
      intent: "proposal",
      operation: "redo",
      targetStepId: "proposal-undo",
      actions: redoPlan.writes.flatMap((batch) => batch.actions),
    });
    expect(queryReview(fixture.snapshot(), fixture.generation()).hunks.length).toBeGreaterThan(0);
  });

  it("rejects Redo after another History channel replaces its structural attribution", () => {
    const fixture = baseFixture();
    for (const nodeId of ["parent-a", "parent-b"]) {
      fixture.fact({ kind: "node-create", nodeId, ownerNodeId: "workspace", originalPlacement: null });
    }
    fixture.step({
      invocationId: "move-a",
      channelId: "channel-a",
      actions: [{ kind: "placement-move", placementId: "occurrence", parentNodeId: "parent-a", anchor: end }],
    });
    const undo = queryHistory("channel-a", fixture.snapshot()).undo!;
    const undoPlan = validateHistorySelection("undo", undo, fixture.snapshot(), fixture.generation());
    if (undoPlan.kind !== "ready") {
      throw new Error("Initial Undo must be ready");
    }
    fixture.step({
      invocationId: "undo-a",
      channelId: "channel-a",
      operation: "undo",
      targetStepId: "move-a",
      actions: undoPlan.writes.flatMap((batch) => batch.actions),
    });
    fixture.step({
      invocationId: "move-b",
      channelId: "channel-b",
      actions: [{ kind: "placement-move", placementId: "occurrence", parentNodeId: "parent-b", anchor: end }],
    });

    const redo = queryHistory("channel-a", fixture.snapshot()).redo!;
    expect(validateHistorySelection("redo", redo, fixture.snapshot(), fixture.generation()).kind).toBe("unavailable");
  });
});

function expectUndoUnavailable(fixture: HistoryFixture): void {
  const selection = queryHistory("channel", fixture.snapshot()).undo;
  if (!selection) {
    return;
  }
  expect(validateHistorySelection("undo", selection, fixture.snapshot(), fixture.generation()).kind).toBe(
    "unavailable",
  );
}

function receiptActionId(factId: FactId | undefined): FactActionId {
  if (!factId) {
    throw new Error("Expected receipt to contain one Fact");
  }
  return factActionId(factId, 0);
}
