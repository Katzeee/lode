import { FIELD_DATATYPE_NODE_IDS, type AuthoredAction } from "../../../src/domain/fact/index.js";
import type { ProposalLifecycleCase } from "./proposal-lifecycle-types.js";
import { materializedFieldFacts, supertagAndFieldFacts } from "./materialized-field-test-facts.js";
import type { Facts } from "./reconcile-test-helpers.js";

export const fieldProposalLifecycleCases = {
  "field-materialize": fieldMaterializeCase,
  "field-value-remove": fieldValueRemoveCase,
  "materialized-field-clear": materializedFieldClearCase,
  "field-configuration-set": fieldConfigurationSetCase,
} as const;

function fieldConfigurationSetCase(): ProposalLifecycleCase {
  const facts = supertagAndFieldFacts();
  facts.add({
    kind: "field-configuration-set",
    fieldDefinitionId: "field",
    configuration: { kind: "datatype", datatypeNodeId: FIELD_DATATYPE_NODE_IDS.options },
  });
  return lifecycle(facts, {
    kind: "field-configuration-set",
    fieldDefinitionId: "field",
    configuration: { kind: "datatype", datatypeNodeId: FIELD_DATATYPE_NODE_IDS.plain },
  });
}

function fieldMaterializeCase(): ProposalLifecycleCase {
  const facts = materializedFieldFacts(false, false);
  return lifecycle(facts, {
    kind: "field-materialize",
    ownerNodeId: "node",
    fieldDefinitionId: "field",
    fieldNodeId: "field-node",
    fieldOccurrenceId: "field-occurrence",
  });
}

function fieldValueRemoveCase(): ProposalLifecycleCase {
  const facts = materializedFieldFacts(true);
  return lifecycle(facts, {
    kind: "field-value-remove",
    valuePlacementId: "value-occurrence",
  });
}

function materializedFieldClearCase(): ProposalLifecycleCase {
  const facts = materializedFieldFacts(true);
  return lifecycle(facts, {
    kind: "materialized-field-clear",
    ownerNodeId: "node",
    fieldDefinitionId: "field",
  });
}

function lifecycle(facts: Facts, action: AuthoredAction): ProposalLifecycleCase {
  return { kind: action.kind, facts, proposal: facts.add(action, "proposal") };
}
