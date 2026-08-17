import { describe, expect, it } from "vitest";

import { workspaceTrashNodeId, workspaceTrashOccurrenceId } from "../../../domain/fact/index.js";
import { rebuildGeneration } from "../../../domain/reconcile/index.js";
import { base, end, Facts, versions } from "../../../../tests/support/reconcile/reconcile-test-helpers.js";
import { prepareEdits } from "./index.js";

describe("domain Edit write boundaries", () => {
  it("reserves Workspace root creation for genesis at the planning boundary", () => {
    const facts = new Facts();
    const snapshot = facts.snapshot();
    const generation = rebuildGeneration("workspace", snapshot, versions).generation;

    expect(() =>
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
      ),
    ).toThrow("Workspace identity is created only by Workspace genesis");
  });

  it("keeps Node creation and Trash placement atomic", () => {
    const creationFacts = new Facts();
    const creationSnapshot = creationFacts.snapshot();
    const creationGeneration = rebuildGeneration("workspace", creationSnapshot, versions).generation;
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
      ),
    ).toMatchObject([
      {
        kind: "atomic",
        mutations: [
          { kind: "node-create", nodeId: "node" },
          { kind: "node-owner-set", nodeId: "node", ownerNodeId: "workspace", previousOwnerNodeId: null },
          { kind: "occurrence-create", occurrenceId: "node-original" },
        ],
      },
    ]);

    const deletionFacts = base();
    const deletionSnapshot = deletionFacts.snapshot();
    const deletionGeneration = rebuildGeneration("workspace", deletionSnapshot, versions).generation;
    expect(
      prepareEdits(
        "workspace",
        "actor",
        [{ kind: "node-delete", nodeId: "node" }],
        deletionGeneration,
        "direct",
        deletionSnapshot,
      ),
    ).toEqual([
      {
        kind: "atomic",
        mutations: [
          { kind: "node-delete", nodeId: "node" },
          {
            kind: "node-owner-set",
            nodeId: "node",
            ownerNodeId: workspaceTrashNodeId("workspace"),
            previousOwnerNodeId: "workspace",
          },
          {
            kind: "occurrence-move",
            occurrenceId: "occurrence",
            parentNodeId: workspaceTrashNodeId("workspace"),
            anchor: end,
            previousParentNodeId: "workspace",
            previousAnchor: {
              after: workspaceTrashOccurrenceId("workspace"),
              before: null,
              affinity: "after",
              fallback: "end",
            },
          },
        ],
      },
    ]);
  });

  it("keeps independent Edits as independent single writes", () => {
    const facts = base();
    const snapshot = facts.snapshot();
    const generation = rebuildGeneration("workspace", snapshot, versions).generation;
    const writes = prepareEdits(
      "workspace",
      "actor",
      [
        { kind: "text-splice", nodeId: "node", deleteAtomIds: [], anchor: end, insert: "first" },
        { kind: "text-splice", nodeId: "node", deleteAtomIds: [], anchor: end, insert: "second" },
      ],
      generation,
      "direct",
      snapshot,
    );

    expect(writes.map((write) => write.kind)).toEqual(["single", "single"]);
  });
});
