import type { Mutation } from "../fact/index.js";
import type { ProposalLifecycleCase } from "./proposal-lifecycle-test-helpers.js";
import { base, end } from "./reconcile-test-helpers.js";
import { addPlacedNode } from "./placed-node-test-helpers.js";
import type { Facts } from "./reconcile-test-helpers.js";

export const fieldProposalLifecycleCases = {
  "field-materialize": fieldMaterializeCase,
  "field-value-delete": fieldValueDeleteCase,
  "materialized-field-delete": materializedFieldDeleteCase,
  "field-initialize": fieldInitializeCase,
} as const;

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
  const facts = schemaAndFieldFacts();
  facts.add({
    kind: "schema-field-add",
    schemaId: "schema",
    fieldDefinitionId: "field",
    fieldNodeId: "schema-field-template-field",
    fieldOccurrenceId: "schema-field-template-field-occurrence",
    anchor: end,
  });
  facts.add({ kind: "schema-apply", nodeId: "node", schemaId: "schema", anchor: end });
  facts.add({
    kind: "schema-field-configure",
    schemaId: "schema",
    fieldDefinitionId: "field",
    fieldNodeId: "schema-field-template-field",

    config: {
      visibility: "normal",
      staticDefault: [{ kind: "text", value: "default" }],
      initializer: null,
    },
    previousConfig: { visibility: "normal", staticDefault: null, initializer: null },
    observedConfigFactIds: [],
  });
  return lifecycle(facts, {
    kind: "field-initialize",
    ownerNodeId: "node",
    schemaId: "schema",
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
  const facts = schemaAndFieldFacts();
  facts.add({ kind: "node-create", nodeId: "field-node" });
  facts.add({
    kind: "occurrence-create",
    occurrenceId: "field-occurrence",
    nodeId: "field-node",
    parentNodeId: "node",
    anchor: end,
  });
  facts.add({
    kind: "schema-field-add",
    schemaId: "schema",
    fieldDefinitionId: "field",
    fieldNodeId: "schema-field-template-field",
    fieldOccurrenceId: "schema-field-template-field-occurrence",
    anchor: end,
  });
  facts.add({ kind: "schema-apply", nodeId: "node", schemaId: "schema", anchor: end });
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

function schemaAndFieldFacts(): Facts {
  const facts = base();
  addPlacedNode(facts, "schema");
  addPlacedNode(facts, "field");
  return facts;
}

function lifecycle(facts: Facts, mutation: Mutation): ProposalLifecycleCase {
  return { kind: mutation.kind, facts, proposal: facts.add(mutation, "proposal") };
}
