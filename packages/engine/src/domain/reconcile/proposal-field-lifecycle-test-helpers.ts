import type { Mutation } from "../fact/index.js";
import type { ProposalLifecycleCase } from "./proposal-lifecycle-test-helpers.js";
import { base, end } from "./reconcile-test-helpers.js";
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
    previousParentOccurrenceId: "field-occurrence",
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
    previousParentOccurrenceId: "occurrence",
    previousAnchor: end,
  });
}

function fieldInitializeCase(): ProposalLifecycleCase {
  const facts = schemaAndFieldFacts();
  facts.add({
    kind: "schema-field-add",
    schemaId: "schema",
    fieldDefinitionId: "field",
    anchor: end,
  });
  facts.add({ kind: "schema-apply", nodeId: "node", schemaId: "schema", anchor: end });
  facts.add({
    kind: "schema-field-configure",
    schemaId: "schema",
    fieldDefinitionId: "field",
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
    source: "static-default",
    values: [{ kind: "text", value: "default" }],
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
    parentOccurrenceId: "occurrence",
    parentPolicy: "cascade",
    anchor: end,
  });
  facts.add({
    kind: "schema-field-add",
    schemaId: "schema",
    fieldDefinitionId: "field",
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
      parentOccurrenceId: "field-occurrence",
      parentPolicy: "cascade",
      anchor: end,
    });
  }
  return facts;
}

function schemaAndFieldFacts(): Facts {
  const facts = base();
  facts.add({ kind: "node-create", nodeId: "schema" });
  facts.add({ kind: "node-create", nodeId: "field" });
  return facts;
}

function lifecycle(facts: Facts, mutation: Mutation): ProposalLifecycleCase {
  return { kind: mutation.kind, facts, proposal: facts.add(mutation, "proposal") };
}
