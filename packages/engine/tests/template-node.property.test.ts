import { describe, expect, it } from "vitest";

import { canonicalJson, makeFact, type Fact, type FactFrontier, type GraphAction } from "../src/domain/fact/index.js";
import {
  rebuildGeneration,
  textAtoms,
  CURRENT_PROJECTION_VERSIONS as versions,
} from "../src/domain/reconcile/index.js";
import { snapshotOf } from "./support/facts.js";
import { shuffle } from "./support/permutation.js";
import { end, Facts } from "./support/reconcile/reconcile-test-helpers.js";
import { addDefinitionNode } from "./support/reconcile/placed-node-test-helpers.js";

const removeReplica = "202";
const addReplica = "303";

describe("Template Node convergence", () => {
  it("preserves concurrent Reference insertion when an observed template appearance is removed across 32 arrival topologies", () => {
    const base = fixture();
    const baseSnapshot = snapshotOf(base.values);
    const frontier = baseSnapshot.frontier;
    const remove = remoteEdit(removeReplica, frontier, base.values.length + 1, [
      {
        kind: "placement-remove",
        placementId: "template-reference-observed",
      },
    ]);
    const add = remoteFact(addReplica, frontier, base.values.length + 1, {
      kind: "placement-create",
      placementId: "template-reference-new",
      parentNodeId: "supertag",
      nodeId: "guidance",
      anchor: end,
    });
    const merged = snapshotOf([...base.values, remove, add]);
    const expected = summary(rebuildGeneration("workspace", merged, versions));

    for (let seed = 1; seed <= 32; seed += 1) {
      const snapshot = snapshotOf(shuffle([...base.values, remove, add, add], seed));
      const full = rebuildGeneration("workspace", snapshot, versions);
      expect(summary(full)).toEqual(expected);
      expect(full.origin.supertagTemplateNodes.supertag).toEqual(["guidance"]);
      expect(full.origin.templateNodeInstances[0]).toMatchObject({
        state: "reference",
        instanceNodeId: null,
        detachmentActionIds: [],
      });
      expect(
        textAtoms(full.origin.nodes.guidance)
          .map((atom) => atom.value)
          .join(""),
      ).toBe("Guidance");
    }
  });
});

function fixture(): Facts {
  const facts = new Facts();
  addDefinitionNode(facts, "supertag", "supertag-definition");
  facts.addPlaced("guidance");
  facts.addPlaced("note", "workspace", "note-occurrence");
  facts.add({
    kind: "rich-text-splice",
    nodeId: "guidance",
    deleteAtomIds: [],
    anchor: end,
    insert: "Guidance",
  });
  facts.add({
    kind: "placement-create",
    placementId: "template-reference-observed",
    parentNodeId: "supertag",
    nodeId: "guidance",
    anchor: end,
  });
  facts.applySupertag("note", "supertag");
  return facts;
}

function remoteFact(replicaId: string, observed: FactFrontier, lamport: number, authoredAction: GraphAction): Fact {
  return makeFact({
    workspaceId: "workspace",
    replicaId,
    sequence: 1,
    observed,
    lamport,
    body: { kind: "action", actorId: replicaId, intent: "direct", actions: [authoredAction] },
  });
}

function remoteEdit(replicaId: string, observed: FactFrontier, lamport: number, actions: readonly GraphAction[]): Fact {
  const [first, ...rest] = actions;
  if (!first) {
    throw new Error("Remote edit requires at least one GraphAction");
  }
  return makeFact({
    workspaceId: "workspace",
    replicaId,
    sequence: 1,
    observed,
    lamport,
    body: { kind: "action", actorId: replicaId, intent: "direct", actions: [first, ...rest] },
  });
}

function summary(result: ReturnType<typeof rebuildGeneration>): string {
  return canonicalJson({ origin: result.origin, review: result.review });
}
