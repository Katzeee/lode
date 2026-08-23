import { addDefinitionNode, addPlacedNode } from "./placed-node-test-helpers.js";
import { base, end, type Facts } from "./reconcile-test-helpers.js";

export function fullSurface(intent: "direct" | "proposal"): Facts {
  const facts = base(intent);
  addPlacedNode(facts, "reference-parent", intent);
  addPlacedNode(facts, "moved-parent", intent);
  addDefinitionNode(facts, "supertag", "supertag-definition", intent);
  addDefinitionNode(facts, "field", "field-definition", intent);
  const splice = facts.add(
    {
      kind: "rich-text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      anchor: end,
      insert: "AB",
    },
    intent,
  );
  facts.add(
    {
      kind: "rich-text-mark",
      nodeId: "node",
      atomIds: [`${splice.id}#0`],
      key: "bold",
      value: { kind: "set", value: true },
    },
    intent,
  );
  facts.applySupertag("node", "supertag", intent);
  facts.add(
    {
      kind: "placement-create",
      placementId: "reference",
      nodeId: "node",
      parentNodeId: "reference-parent",
      anchor: end,
    },
    intent,
  );
  facts.add(
    {
      kind: "placement-move",
      placementId: "reference",
      parentNodeId: "moved-parent",
      anchor: end,
    },
    intent,
  );
  return facts;
}
