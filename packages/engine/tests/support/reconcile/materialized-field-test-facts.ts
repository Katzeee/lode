import {
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  materializedFieldNodeId,
  materializedFieldOccurrenceId,
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
} from "../../../src/domain/fact/index.js";
import { addDefinitionNode } from "./placed-node-test-helpers.js";
import { base, type Facts } from "./reconcile-test-helpers.js";

export function materializedFieldFacts(withValue: boolean, withMaterialization = true): Facts {
  const facts = supertagAndFieldFacts();
  const fieldNodeId = materializedFieldNodeId("node", "field");
  facts.addPlaced(fieldNodeId, "node", materializedFieldOccurrenceId("node", "field"));
  if (withMaterialization) {
    facts.add({
      kind: "field-materialize",
      ownerNodeId: "node",
      fieldDefinitionId: "field",
    });
  }
  if (withValue) {
    facts.addPlaced("value-node", fieldNodeId, "value-occurrence");
  }
  return facts;
}

export function supertagAndFieldFacts(): Facts {
  const facts = base();
  addDefinitionNode(facts, "supertag", SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE);
  addDefinitionNode(facts, "field", FIELD_DEFINITION_INTRINSIC_NODE_TYPE);
  return facts;
}
