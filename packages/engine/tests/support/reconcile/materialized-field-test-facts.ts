import {
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
} from "../../../src/domain/fact/index.js";
import { addDefinitionNode } from "./placed-node-test-helpers.js";
import { base, end, type Facts } from "./reconcile-test-helpers.js";

export function materializedFieldFacts(withValue: boolean, withMaterialization = true): Facts {
  const facts = supertagAndFieldFacts();
  facts.add({ kind: "node-create", nodeId: "field-node" });
  facts.add({
    kind: "occurrence-create",
    occurrenceId: "field-occurrence",
    nodeId: "field-node",
    parentNodeId: "node",
    anchor: end,
  });
  if (withMaterialization) {
    facts.add({
      kind: "field-materialize",
      ownerNodeId: "node",
      fieldDefinitionId: "field",
      fieldNodeId: "field-node",
      fieldOccurrenceId: "field-occurrence",
    });
  }
  if (withValue) {
    facts.add({ kind: "node-create", nodeId: "value-node" });
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "value-occurrence",
      nodeId: "value-node",
      parentNodeId: "field-node",
      anchor: end,
    });
  }
  return facts;
}

export function supertagAndFieldFacts(): Facts {
  const facts = base();
  addDefinitionNode(facts, "supertag", SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE);
  addDefinitionNode(facts, "field", FIELD_DEFINITION_INTRINSIC_NODE_TYPE);
  return facts;
}
