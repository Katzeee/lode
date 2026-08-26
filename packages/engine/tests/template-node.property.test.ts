import { describe, expect, it } from "vitest";

import { buildFactSnapshot } from "../src/domain/fact/index.js";
import {
  canonicalJson,
  factActions,
  makeFact,
  templateInstanceNodeId,
  templateInstanceOccurrenceId,
  type Fact,
  type FactFrontier,
  type GraphAction,
} from "../src/domain/fact/index.js";
import {
  advanceGeneration,
  rebuildGeneration,
  textAtoms,
  CURRENT_PROJECTION_VERSIONS as versions,
} from "../src/domain/reconcile/index.js";
import { uniqueFacts } from "./support/facts.js";
import { end, Facts } from "./support/reconcile/reconcile-test-helpers.js";
import { addDefinitionNode } from "./support/reconcile/placed-node-test-helpers.js";

const removeReplica = "202";
const addReplica = "303";
const detachReplica = "404";

describe("Template Node convergence", () => {
  it("preserves concurrent observed-remove support and detached content across 32 arrival topologies", () => {
    const base = fixture();
    const baseSnapshot = snapshotOf(base.values);
    const frontier = baseSnapshot.frontier;
    const remove = remoteEdit(removeReplica, frontier, base.values.length + 1, [
      {
        kind: "template-member-remove",
        supertagId: "supertag",
        templateNodeId: "guidance",
      },
    ]);
    const add = remoteFact(addReplica, frontier, base.values.length + 1, {
      kind: "template-member-add",
      supertagId: "supertag",
      templateNodeId: "guidance",
      anchor: end,
    });
    const merged = snapshotOf([...base.values, remove, add]);
    const detachment = remoteEdit(
      detachReplica,
      merged.frontier,
      Math.max(...merged.facts.map((fact) => fact.coordinate.lamport)) + 1,
      [
        {
          kind: "node-create",
          nodeId: templateInstanceNodeId("note", "guidance"),
          ownerNodeId: "note",
          originalPlacement: {
            placementId: templateInstanceOccurrenceId("note", "guidance"),
            anchor: end,
          },
          seed: {
            text: [..."Guidance"].map((value) => ({ value, attributes: {} })),
          },
        },
        {
          kind: "template-node-detach",
          ownerNodeId: "note",
          templateNodeId: "guidance",
          instanceNodeId: templateInstanceNodeId("note", "guidance"),
          instanceOccurrenceId: templateInstanceOccurrenceId("note", "guidance"),
          anchor: end,
        },
      ],
    );
    const detach = factActions(detachment).find((fact) => fact.action.kind === "template-node-detach")!;
    const expected = summary(rebuildGeneration("workspace", snapshotOf([...merged.facts, detachment]), versions));

    for (let seed = 1; seed <= 32; seed += 1) {
      const snapshot = snapshotOf(shuffle([...base.values, remove, add, detachment, add], seed));
      const full = rebuildGeneration("workspace", snapshot, versions);
      expect(summary(full)).toEqual(expected);
      expect(full.origin.supertagTemplateNodes.supertag).toEqual(["guidance"]);
      expect(full.origin.templateNodeInstances[0]).toMatchObject({
        state: "detached",
        instanceNodeId: templateInstanceNodeId("note", "guidance"),
        detachmentActionIds: [detach.id],
      });
      expect(
        textAtoms(full.origin.nodes[templateInstanceNodeId("note", "guidance")])
          .map((atom) => atom.value)
          .join(""),
      ).toBe("Guidance");
    }

    const before = rebuildGeneration("workspace", baseSnapshot, versions);
    const finalSnapshot = snapshotOf([...base.values, remove, add, detachment]);
    const incremental = advanceGeneration("workspace", baseSnapshot, finalSnapshot, versions, before);
    expect(summary(incremental)).toEqual(expected);
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
    kind: "template-member-add",
    supertagId: "supertag",
    templateNodeId: "guidance",
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

function snapshotOf(facts: readonly Fact[]) {
  const snapshot = buildFactSnapshot("workspace", uniqueFacts(facts));
  return snapshot;
}

function summary(result: ReturnType<typeof rebuildGeneration>): string {
  return canonicalJson({ origin: result.origin, review: result.review });
}

function shuffle(values: Fact[], seed: number): Fact[] {
  let state = seed >>> 0;
  for (let index = values.length - 1; index > 0; index -= 1) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    const selected = state % (index + 1);
    const current = values[index];
    const replacement = values[selected];
    if (!current || !replacement) {
      throw new Error("Shuffle selected an absent Fact");
    }
    values[index] = replacement;
    values[selected] = current;
  }
  return values;
}
