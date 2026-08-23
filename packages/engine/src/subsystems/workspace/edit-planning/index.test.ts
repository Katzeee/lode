import { describe, expect, it } from "vitest";

import { rebuildGeneration } from "../../../domain/reconcile/index.js";
import { base, end, Facts, versions } from "../../../../tests/support/reconcile/reconcile-test-helpers.js";
import { prepareEdits } from "./index.js";

describe("Edit Fact boundaries", () => {
  it("reserves Workspace root creation for genesis at the planning boundary", () => {
    const facts = new Facts();
    const snapshot = facts.snapshot();
    const generation = rebuildGeneration("workspace", snapshot, versions);

    expect(
      () =>
        prepareEdits(
          "workspace",
          "actor",
          [
            {
              kind: "node-create",
              nodeId: "workspace",
              occurrenceId: "workspace-original",
              parentNodeId: "workspace",
              anchor: end,
            },
          ],
          generation,
          "direct",
          snapshot,
          "101",
        ).writes,
    ).toThrow("Workspace identity is created only by Workspace genesis");
  });

  it("emits one non-empty action batch for each Edit", () => {
    const creationFacts = new Facts();
    const creationSnapshot = creationFacts.snapshot();
    const creationGeneration = rebuildGeneration("workspace", creationSnapshot, versions);
    expect(
      prepareEdits(
        "workspace",
        "actor",
        [
          {
            kind: "node-create",
            nodeId: "node",
            occurrenceId: "node-original",
            parentNodeId: "workspace",
            anchor: end,
          },
        ],
        creationGeneration,
        "direct",
        creationSnapshot,
        "101",
      ).writes,
    ).toMatchObject([
      [
        {
          kind: "node-create",
          nodeId: "node",
          ownerNodeId: "workspace",
          originalPlacement: { placementId: "node-original", anchor: end },
        },
      ],
    ]);

    const deletionFacts = base();
    const deletionSnapshot = deletionFacts.snapshot();
    const deletionGeneration = rebuildGeneration("workspace", deletionSnapshot, versions);
    expect(
      prepareEdits(
        "workspace",
        "actor",
        [{ kind: "node-delete", nodeId: "node" }],
        deletionGeneration,
        "direct",
        deletionSnapshot,
        "101",
      ).writes,
    ).toEqual([[{ kind: "node-trash", nodeId: "node" }]]);
  });

  it("keeps independent Edits in separate Fact batches", () => {
    const facts = base();
    const snapshot = facts.snapshot();
    const generation = rebuildGeneration("workspace", snapshot, versions);
    const writes = prepareEdits(
      "workspace",
      "actor",
      [
        { kind: "rich-text-splice", nodeId: "node", deleteAtomIds: [], anchor: end, insert: "first" },
        { kind: "rich-text-splice", nodeId: "node", deleteAtomIds: [], anchor: end, insert: "second" },
      ],
      generation,
      "direct",
      snapshot,
      "101",
    );

    expect(writes.writes).toHaveLength(2);
    expect(writes.writes.map(([action]) => action.kind)).toEqual(["rich-text-splice", "rich-text-splice"]);
  });
});
