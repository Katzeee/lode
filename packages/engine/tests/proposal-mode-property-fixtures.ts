import { type Fact, type TextAtomId } from "../src/domain/fact/index.js";
import { end, Facts } from "./support/reconcile/reconcile-test-helpers.js";
import { addDefinitionNode } from "./support/reconcile/placed-node-test-helpers.js";

export function generatedDomainGraph(seed: number): readonly Fact[] {
  const facts = new Facts();
  facts.addPlaced("root", "workspace", "root-occurrence");
  facts.addPlaced("shared", "root", "shared-a");
  facts.addPlaced("container-a", "root", "cascade-parent");
  facts.addPlaced("container-b", "root", "rehome-parent");
  facts.addPlaced("child-a", "container-a", "cascade-child");
  facts.addPlaced("child-b", "container-b", "rehome-child");
  occurrence(facts, "shared-b", "shared", "container-a");
  occurrence(facts, "self-reference", "shared", "shared");
  addDefinitionNode(facts, "generated-supertag", "supertag-definition");
  facts.applySupertag("shared", "generated-supertag");
  const text = facts.add({
    kind: "rich-text-splice",
    nodeId: "shared",
    deleteAtomIds: [],
    anchor: end,
    insert: "ABCDE".slice(0, 2 + (seed % 4)),
  });
  const atomCount = 2 + (seed % 4);
  const marked = Array.from({ length: atomCount }, (_, index): TextAtomId => `${text.id}#${index}`).filter(
    (_, index) => (index + seed) % 2 === 0,
  );
  facts.add({
    kind: "rich-text-mark",
    nodeId: "shared",
    atomIds: marked,
    key: "emphasis",
    value: { kind: "set", value: seed % 2 === 0 },
  });
  const contentProposal = facts.add(
    {
      kind: "rich-text-splice",
      nodeId: "shared",
      deleteAtomIds: [],
      anchor: end,
      insert: String(seed),
    },
    "proposal",
  );
  const createProposal = facts.addPlaced(`proposal-${seed}`, "workspace", undefined, "proposal");
  facts.add({
    kind: "rich-text-splice",
    nodeId: `proposal-${seed}`,
    deleteAtomIds: [],
    anchor: end,
    insert: "dependent",
  });
  facts.add(
    {
      kind: "placement-move",
      placementId: "shared-b",
      parentNodeId: "container-b",
      anchor: end,
    },
    "proposal",
  );
  facts.resolve(
    seed % 2 === 0
      ? [contentProposal.id, ...createProposal.map((fact) => fact.id)]
      : [...createProposal.map((fact) => fact.id), contentProposal.id],
    seed % 3 === 0 ? "reject" : "accept",
  );
  return facts.values;
}

function occurrence(facts: Facts, occurrenceId: string, nodeId: string, parentNodeId: string): void {
  facts.add({
    kind: "placement-create",
    placementId: occurrenceId,
    nodeId,
    parentNodeId,
    anchor: end,
  });
}
