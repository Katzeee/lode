import {
  FIELD_DEFINITION_NODE_TYPE,
  SUPERTAG_DEFINITION_NODE_TYPE,
  type Mutation,
} from "../../../src/domain/fact/index.js";
import type { ProposalLifecycleCase } from "./proposal-lifecycle-types.js";
import { base, end } from "./reconcile-test-helpers.js";
import { addDefinitionNode } from "./placed-node-test-helpers.js";
import type { Facts } from "./reconcile-test-helpers.js";

export const fieldProposalLifecycleCases = {
  "field-materialize": fieldMaterializeCase,
  "field-value-delete": fieldValueDeleteCase,
  "materialized-field-delete": materializedFieldDeleteCase,
  "field-initialize": fieldInitializeCase,
  "field-datatype-configure": fieldDatatypeConfigureCase,
  "field-cardinality-configure": fieldCardinalityConfigureCase,
  "field-initialization-expression-configure": fieldInitializationExpressionConfigureCase,
} as const;

function fieldDatatypeConfigureCase(): ProposalLifecycleCase {
  const facts = fieldDefinitionConfigurationFacts("datatype-configuration");
  const previous = facts.add({
    kind: "field-datatype-configure",
    fieldDefinitionId: "field",
    configurationNodeId: "datatype-configuration",
    configurationOccurrenceId: "datatype-configuration-occurrence",
    datatype: "options",
    previousDatatype: null,
    observedValueFactIds: [],
  });
  return lifecycle(facts, {
    kind: "field-datatype-configure",
    fieldDefinitionId: "field",
    configurationNodeId: "datatype-configuration",
    configurationOccurrenceId: "datatype-configuration-occurrence",
    datatype: "plain",
    previousDatatype: "options",
    observedValueFactIds: [previous.id],
  });
}

function fieldCardinalityConfigureCase(): ProposalLifecycleCase {
  const facts = fieldDefinitionConfigurationFacts("cardinality-configuration");
  const previous = facts.add({
    kind: "field-cardinality-configure",
    fieldDefinitionId: "field",
    configurationNodeId: "cardinality-configuration",
    configurationOccurrenceId: "cardinality-configuration-occurrence",
    cardinality: "list",
    previousCardinality: null,
    observedValueFactIds: [],
  });
  return lifecycle(facts, {
    kind: "field-cardinality-configure",
    fieldDefinitionId: "field",
    configurationNodeId: "cardinality-configuration",
    configurationOccurrenceId: "cardinality-configuration-occurrence",
    cardinality: "single",
    previousCardinality: "list",
    observedValueFactIds: [previous.id],
  });
}

function fieldInitializationExpressionConfigureCase(): ProposalLifecycleCase {
  const facts = fieldDefinitionConfigurationFacts("initialization-configuration");
  return lifecycle(facts, {
    kind: "field-initialization-expression-configure",
    fieldDefinitionId: "field",
    configurationNodeId: "initialization-configuration",
    configurationOccurrenceId: "initialization-configuration-occurrence",
    expression: { kind: "ancestor-field-values", sourceFieldDefinitionId: "field" },
    previousExpression: null,
    observedValueFactIds: [],
  });
}

function fieldDefinitionConfigurationFacts(configurationNodeId: string): Facts {
  const facts = supertagAndFieldFacts();
  facts.add({ kind: "node-create", nodeId: "field-metanode" });
  facts.add({ kind: "metanode-attach", hostNodeId: "field", metanodeId: "field-metanode" });
  facts.add({ kind: "node-create", nodeId: configurationNodeId });
  facts.add({
    kind: "occurrence-create",
    occurrenceId: `${configurationNodeId}-occurrence`,
    nodeId: configurationNodeId,
    parentNodeId: "field-metanode",
    anchor: end,
  });
  return facts;
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

function fieldValueDeleteCase(): ProposalLifecycleCase {
  const facts = materializedFieldFacts(true);
  return lifecycle(facts, {
    kind: "field-value-delete",
    ownerNodeId: "node",
    fieldDefinitionId: "field",
    valueOccurrenceId: "value-occurrence",
    previousParentNodeId: "field-node",
    previousAnchor: end,
  });
}

function materializedFieldDeleteCase(): ProposalLifecycleCase {
  const facts = materializedFieldFacts(true);
  return lifecycle(facts, {
    kind: "materialized-field-delete",
    ownerNodeId: "node",
    fieldDefinitionId: "field",
    fieldNodeId: "field-node",
    fieldOccurrenceId: "field-occurrence",
    previousParentNodeId: "node",
    previousAnchor: end,
  });
}

function fieldInitializeCase(): ProposalLifecycleCase {
  const facts = supertagAndFieldFacts();
  facts.add({
    kind: "supertag-field-add",
    supertagId: "supertag",
    fieldDefinitionId: "field",
    fieldNodeId: "supertag-field-template-field",
    fieldOccurrenceId: "supertag-field-template-field-occurrence",
    anchor: end,
  });
  facts.add({ kind: "supertag-apply", nodeId: "node", supertagId: "supertag", anchor: end });
  facts.add({
    kind: "supertag-field-configure",
    supertagId: "supertag",
    fieldDefinitionId: "field",
    fieldNodeId: "supertag-field-template-field",

    config: {
      visibility: "normal",
      staticDefault: [{ kind: "text", value: "default" }],
    },
    previousConfig: { visibility: "normal", staticDefault: null },
    observedConfigFactIds: [],
  });
  return lifecycle(facts, {
    kind: "field-initialize",
    ownerNodeId: "node",
    supertagId: "supertag",
    fieldDefinitionId: "field",
    fieldNodeId: "initialized-field:v1:node:field",
    fieldOccurrenceId: "initialized-field-occ:v1:node:field",
    source: "static-default",
    values: [
      {
        kind: "text",
        nodeId: "initialized-field:v1:node:field:value:0",
        occurrenceId: "initialized-field-occ:v1:node:field:value:0",
        value: "default",
      },
    ],
    observedInitializationFactIds: [],
  });
}

function materializedFieldFacts(withValue: boolean, withMaterialization = true): Facts {
  const facts = supertagAndFieldFacts();
  facts.add({ kind: "node-create", nodeId: "field-node" });
  facts.add({
    kind: "occurrence-create",
    occurrenceId: "field-occurrence",
    nodeId: "field-node",
    parentNodeId: "node",
    anchor: end,
  });
  facts.add({
    kind: "supertag-field-add",
    supertagId: "supertag",
    fieldDefinitionId: "field",
    fieldNodeId: "supertag-field-template-field",
    fieldOccurrenceId: "supertag-field-template-field-occurrence",
    anchor: end,
  });
  facts.add({ kind: "supertag-apply", nodeId: "node", supertagId: "supertag", anchor: end });
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

function supertagAndFieldFacts(): Facts {
  const facts = base();
  addDefinitionNode(facts, "supertag", SUPERTAG_DEFINITION_NODE_TYPE);
  addDefinitionNode(facts, "field", FIELD_DEFINITION_NODE_TYPE);
  return facts;
}

function lifecycle(facts: Facts, mutation: Mutation): ProposalLifecycleCase {
  return { kind: mutation.kind, facts, proposal: facts.add(mutation, "proposal") };
}
