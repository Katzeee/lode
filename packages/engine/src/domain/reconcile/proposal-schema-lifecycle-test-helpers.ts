import type { Mutation } from "../fact/index.js";
import type { ProposalLifecycleCase } from "./proposal-lifecycle-test-helpers.js";
import { base, end } from "./reconcile-test-helpers.js";
import type { Facts } from "./reconcile-test-helpers.js";
import { templateNodeItemId } from "./template-node-identity.js";

export const schemaProposalLifecycleCases = {
  "schema-apply": schemaApplyCase,
  "schema-remove": schemaRemoveCase,
  "schema-field-add": schemaFieldAddCase,
  "schema-field-remove": schemaFieldRemoveCase,
  "schema-field-configure": schemaFieldConfigureCase,
  "schema-extension-add": schemaExtensionAddCase,
  "schema-extension-remove": schemaExtensionRemoveCase,
  "schema-template-node-add": schemaTemplateNodeAddCase,
  "schema-template-node-remove": schemaTemplateNodeRemoveCase,
  "template-node-detach": templateNodeDetachCase,
} as const;

function schemaApplyCase(): ProposalLifecycleCase {
  const facts = base();
  facts.add({ kind: "node-create", nodeId: "schema" });
  return lifecycle(facts, {
    kind: "schema-apply",
    nodeId: "node",
    schemaId: "schema",
    anchor: end,
  });
}

function schemaRemoveCase(): ProposalLifecycleCase {
  const facts = base();
  facts.add({ kind: "node-create", nodeId: "schema" });
  facts.add({ kind: "schema-apply", nodeId: "node", schemaId: "schema", anchor: end });
  return lifecycle(facts, {
    kind: "schema-remove",
    nodeId: "node",
    schemaId: "schema",
    previousAnchor: end,
  });
}

function schemaFieldAddCase(): ProposalLifecycleCase {
  const facts = schemaAndFieldFacts();
  return lifecycle(facts, {
    kind: "schema-field-add",
    schemaId: "schema",
    fieldDefinitionId: "field",
    anchor: end,
  });
}

function schemaFieldRemoveCase(): ProposalLifecycleCase {
  const facts = schemaAndFieldFacts();
  facts.add({
    kind: "schema-field-add",
    schemaId: "schema",
    fieldDefinitionId: "field",
    anchor: end,
  });
  return lifecycle(facts, {
    kind: "schema-field-remove",
    schemaId: "schema",
    fieldDefinitionId: "field",
    previousAnchor: end,
  });
}

function schemaFieldConfigureCase(): ProposalLifecycleCase {
  const facts = schemaAndFieldFacts();
  facts.add({
    kind: "schema-field-add",
    schemaId: "schema",
    fieldDefinitionId: "field",
    anchor: end,
  });
  return lifecycle(facts, {
    kind: "schema-field-configure",
    schemaId: "schema",
    fieldDefinitionId: "field",
    config: { visibility: "pinned", staticDefault: null, initializer: null },
    previousConfig: { visibility: "normal", staticDefault: null, initializer: null },
    observedConfigFactIds: [],
  });
}

function schemaExtensionAddCase(): ProposalLifecycleCase {
  const facts = schemaPairFacts();
  return lifecycle(facts, {
    kind: "schema-extension-add",
    schemaId: "schema",
    baseSchemaId: "base-schema",
    anchor: end,
  });
}

function schemaExtensionRemoveCase(): ProposalLifecycleCase {
  const facts = schemaPairFacts();
  facts.add({
    kind: "schema-extension-add",
    schemaId: "schema",
    baseSchemaId: "base-schema",
    anchor: end,
  });
  return lifecycle(facts, {
    kind: "schema-extension-remove",
    schemaId: "schema",
    baseSchemaId: "base-schema",
    previousAnchor: end,
  });
}

function schemaTemplateNodeAddCase(): ProposalLifecycleCase {
  const facts = schemaAndTemplateFacts();
  return lifecycle(facts, {
    kind: "schema-template-node-add",
    schemaId: "schema",
    templateNodeId: "template",
    anchor: end,
  });
}

function schemaTemplateNodeRemoveCase(): ProposalLifecycleCase {
  const facts = schemaAndTemplateFacts();
  facts.add({
    kind: "schema-template-node-add",
    schemaId: "schema",
    templateNodeId: "template",
    anchor: end,
  });
  return lifecycle(facts, {
    kind: "schema-template-node-remove",
    schemaId: "schema",
    templateNodeId: "template",
    previousAnchor: end,
  });
}

function templateNodeDetachCase(): ProposalLifecycleCase {
  const facts = schemaAndTemplateFacts();
  facts.add({
    kind: "schema-template-node-add",
    schemaId: "schema",
    templateNodeId: "template",
    anchor: end,
  });
  facts.add({ kind: "schema-apply", nodeId: "node", schemaId: "schema", anchor: end });
  return lifecycle(facts, {
    kind: "template-node-detach",
    ownerNodeId: "node",
    templateNodeId: "template",
    sourceSchemaIds: ["schema"],
    sourceApplicationSchemaIds: ["schema"],
    sourceTemplateItemIds: [templateNodeItemId("schema", "template")],
  });
}

function schemaAndFieldFacts(): Facts {
  const facts = base();
  facts.add({ kind: "node-create", nodeId: "schema" });
  facts.add({ kind: "node-create", nodeId: "field" });
  return facts;
}

function schemaPairFacts(): Facts {
  const facts = base();
  facts.add({ kind: "node-create", nodeId: "schema" });
  facts.add({ kind: "node-create", nodeId: "base-schema" });
  return facts;
}

function schemaAndTemplateFacts(): Facts {
  const facts = base();
  facts.add({ kind: "node-create", nodeId: "schema" });
  facts.add({ kind: "node-create", nodeId: "template" });
  return facts;
}

function lifecycle(facts: Facts, mutation: Mutation): ProposalLifecycleCase {
  return { kind: mutation.kind, facts, proposal: facts.add(mutation, "proposal") };
}
