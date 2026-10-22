import { describe, expect, it } from "vitest";

import { factActionId, factId } from "../../../domain/fact/index.js";
import { rebuildGeneration, searchExpressionProjectionIdentity } from "../../../domain/reconcile/index.js";
import { base, end, Facts, versions } from "../../../../tests/support/reconcile/reconcile-test-helpers.js";
import { prepareEdits } from "./index.js";

describe("Action Fact boundaries", () => {
  it("reserves Workspace root creation for genesis at the planning boundary", () => {
    const facts = new Facts();
    const snapshot = facts.snapshot();
    const generation = rebuildGeneration("workspace", snapshot, versions);

    expect(() =>
      prepareEdits({
        workspaceId: "workspace",
        actorId: "actor",
        edits: [
          {
            kind: "node-create",
            nodeId: "workspace",
            occurrenceId: "workspace-original",
            parentNodeId: "workspace",
            anchor: end,
          },
        ],
        generation,
        intent: "direct",
        snapshot,
        replicaId: "101",
      }),
    ).toThrow("Workspace Node is created only by Workspace bootstrap");
  });

  it("emits one non-empty action batch for each Edit", () => {
    const creationFacts = new Facts();
    const creationSnapshot = creationFacts.snapshot();
    const creationGeneration = rebuildGeneration("workspace", creationSnapshot, versions);
    expect(
      prepareEdits({
        workspaceId: "workspace",
        actorId: "actor",
        edits: [
          {
            kind: "node-create",
            nodeId: "node",
            occurrenceId: "node-original",
            parentNodeId: "workspace",
            anchor: end,
          },
        ],
        generation: creationGeneration,
        intent: "direct",
        snapshot: creationSnapshot,
        replicaId: "101",
      }),
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
      prepareEdits({
        workspaceId: "workspace",
        actorId: "actor",
        edits: [{ kind: "node-delete", nodeId: "node" }],
        generation: deletionGeneration,
        intent: "direct",
        snapshot: deletionSnapshot,
        replicaId: "101",
      }),
    ).toEqual([[{ kind: "node-trash", nodeId: "node" }]]);
  });

  it("keeps independent Edits in separate Fact batches", () => {
    const facts = base();
    const snapshot = facts.snapshot();
    const generation = rebuildGeneration("workspace", snapshot, versions);
    const writes = prepareEdits({
      workspaceId: "workspace",
      actorId: "actor",
      edits: [
        { kind: "rich-text-splice", nodeId: "node", deleteAtomIds: [], anchor: end, insert: "first" },
        { kind: "rich-text-splice", nodeId: "node", deleteAtomIds: [], anchor: end, insert: "second" },
      ],
      generation,
      intent: "direct",
      snapshot,
      replicaId: "101",
    });

    expect(writes).toHaveLength(2);
    expect(writes.map(([action]) => action.kind)).toEqual(["rich-text-splice", "rich-text-splice"]);
  });

  it("plans each Edit against the effects of preceding Edits", () => {
    const facts = new Facts();
    const snapshot = facts.snapshot();
    const generation = rebuildGeneration("workspace", snapshot, versions);

    expect(
      prepareEdits({
        workspaceId: "workspace",
        actorId: "actor",
        edits: [
          {
            kind: "node-create",
            nodeId: "node",
            occurrenceId: "node-original",
            parentNodeId: "workspace",
            anchor: end,
          },
          { kind: "rich-text-splice", nodeId: "node", deleteAtomIds: [], anchor: end, insert: "created" },
        ],
        generation,
        intent: "direct",
        snapshot,
        replicaId: "101",
      }),
    ).toMatchObject([
      [{ kind: "node-create", nodeId: "node" }],
      [{ kind: "rich-text-splice", nodeId: "node", insert: "created" }],
    ]);
  });

  it("derives intra-batch Search identities from final Graph Action positions", () => {
    const facts = new Facts();
    facts.add({
      kind: "node-create",
      nodeId: "search",
      ownerNodeId: "workspace",
      originalPlacement: { placementId: "search-original", anchor: end },
      intrinsicNodeType: "search",
    });
    const snapshot = facts.snapshot();
    const generation = rebuildGeneration("workspace", snapshot, versions);
    const [batch] = prepareEdits({
      workspaceId: "workspace",
      actorId: "actor",
      edits: [
        {
          kind: "search-expression-create",
          searchNodeId: "search",
          expression: {
            kind: "and",
            operands: [
              { kind: "text", text: "first" },
              { kind: "text", text: "second" },
            ],
          },
          anchor: end,
        },
      ],
      generation,
      intent: "direct",
      snapshot,
      replicaId: "101",
    });
    const prospectiveFactId = factId("workspace", "101", (snapshot.frontier["101"] ?? 0) + 1);
    const rootId = factActionId(prospectiveFactId, 0);
    const firstChildId = factActionId(prospectiveFactId, 1);

    expect(batch).toMatchObject([
      { kind: "search-expression-add", parentExpressionId: null },
      { kind: "search-expression-add", parentExpressionId: rootId },
      {
        kind: "search-expression-add",
        parentExpressionId: rootId,
        anchor: { after: searchExpressionProjectionIdentity(firstChildId).expressionOccurrenceId },
      },
    ]);
  });
});
