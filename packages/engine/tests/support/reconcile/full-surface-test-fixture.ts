import { addPlacedNode } from "./placed-node-test-helpers.js";
import { base, end, type Facts } from "./reconcile-test-helpers.js";

export function fullSurface(intent: "direct" | "proposal"): Facts {
  const facts = base(intent);
  addPlacedNode(facts, "reference-parent", intent);
  addPlacedNode(facts, "moved-parent", intent);
  addPlacedNode(facts, "supertag", intent);
  addPlacedNode(facts, "field", intent);
  facts.add(
    { kind: "intrinsic-node-type-declare", nodeId: "supertag", intrinsicNodeType: "supertag-definition" },
    intent,
  );
  facts.add({ kind: "intrinsic-node-type-declare", nodeId: "field", intrinsicNodeType: "field-definition" }, intent);
  const splice = facts.add(
    {
      kind: "text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      deletedAtoms: [],
      anchor: end,
      insert: "AB",
    },
    intent,
  );
  facts.add(
    {
      kind: "text-mark",
      nodeId: "node",
      atomIds: [`${splice.id}#0`],
      key: "bold",
      value: { kind: "set", value: true },
      previous: { kind: "unset" },
    },
    intent,
  );
  facts.applySupertag("node", "supertag", intent);
  facts.add(
    {
      kind: "occurrence-create",
      occurrenceId: "reference",
      nodeId: "node",
      parentNodeId: "reference-parent",
      anchor: end,
    },
    intent,
  );
  facts.add(
    {
      kind: "occurrence-move",
      occurrenceId: "reference",
      parentNodeId: "moved-parent",
      anchor: end,
      previousParentNodeId: "reference-parent",
      previousAnchor: end,
    },
    intent,
  );
  facts.add(
    { kind: "node-owner-set", nodeId: "node", ownerNodeId: "moved-parent", previousOwnerNodeId: "workspace" },
    intent,
  );
  return facts;
}
