import {
  FIELD_DEFINITION_NODE_TYPE,
  SUPERTAG_DEFINITION_NODE_TYPE,
  type Mutation,
} from "../../../src/domain/fact/index.js";
import type { ProposalLifecycleCase } from "./proposal-lifecycle-types.js";
import { base, end } from "./reconcile-test-helpers.js";
import { addDefinitionNode, addPlacedNode } from "./placed-node-test-helpers.js";
import type { Facts } from "./reconcile-test-helpers.js";

export const supertagProposalLifecycleCases = {
  "supertag-apply": supertagApplyCase,
  "supertag-remove": supertagRemoveCase,
  "supertag-field-add": supertagFieldAddCase,
  "supertag-field-remove": supertagFieldRemoveCase,
  "supertag-field-configure": supertagFieldConfigureCase,
  "supertag-extension-add": supertagExtensionAddCase,
  "supertag-extension-remove": supertagExtensionRemoveCase,
  "supertag-template-node-add": supertagTemplateNodeAddCase,
  "supertag-template-node-remove": supertagTemplateNodeRemoveCase,
  "template-node-detach": templateNodeDetachCase,
} as const;

function supertagApplyCase(): ProposalLifecycleCase {
  const facts = base();
  addDefinitionNode(facts, "supertag", SUPERTAG_DEFINITION_NODE_TYPE);
  return lifecycle(facts, {
    kind: "supertag-apply",
    nodeId: "node",
    supertagId: "supertag",
    anchor: end,
  });
}

function supertagRemoveCase(): ProposalLifecycleCase {
  const facts = base();
  addDefinitionNode(facts, "supertag", SUPERTAG_DEFINITION_NODE_TYPE);
  facts.add({ kind: "supertag-apply", nodeId: "node", supertagId: "supertag", anchor: end });
  return lifecycle(facts, {
    kind: "supertag-remove",
    nodeId: "node",
    supertagId: "supertag",
    previousAnchor: end,
  });
}

function supertagFieldAddCase(): ProposalLifecycleCase {
  const facts = supertagAndFieldFacts();
  return lifecycle(facts, {
    kind: "supertag-field-add",
    supertagId: "supertag",
    fieldDefinitionId: "field",
    fieldNodeId: "supertag-field-template-field",
    fieldOccurrenceId: "supertag-field-template-field-occurrence",
    anchor: end,
  });
}

function supertagFieldRemoveCase(): ProposalLifecycleCase {
  const facts = supertagAndFieldFacts();
  facts.add({
    kind: "supertag-field-add",
    supertagId: "supertag",
    fieldDefinitionId: "field",
    fieldNodeId: "supertag-field-template-field",
    fieldOccurrenceId: "supertag-field-template-field-occurrence",
    anchor: end,
  });
  return lifecycle(facts, {
    kind: "supertag-field-remove",
    supertagId: "supertag",
    fieldDefinitionId: "field",
    fieldNodeId: "supertag-field-template-field",
    fieldOccurrenceId: "supertag-field-template-field-occurrence",
    previousAnchor: end,
  });
}

function supertagFieldConfigureCase(): ProposalLifecycleCase {
  const facts = supertagAndFieldFacts();
  facts.add({
    kind: "supertag-field-add",
    supertagId: "supertag",
    fieldDefinitionId: "field",
    fieldNodeId: "supertag-field-template-field",
    fieldOccurrenceId: "supertag-field-template-field-occurrence",
    anchor: end,
  });
  return lifecycle(facts, {
    kind: "supertag-field-configure",
    supertagId: "supertag",
    fieldDefinitionId: "field",
    fieldNodeId: "supertag-field-template-field",

    config: { visibility: "pinned", staticDefault: null },
    previousConfig: { visibility: "normal", staticDefault: null },
    observedConfigFactIds: [],
  });
}

function supertagExtensionAddCase(): ProposalLifecycleCase {
  const facts = supertagPairFacts();
  return lifecycle(facts, {
    kind: "supertag-extension-add",
    supertagId: "supertag",
    baseSupertagId: "base-supertag",
    anchor: end,
  });
}

function supertagExtensionRemoveCase(): ProposalLifecycleCase {
  const facts = supertagPairFacts();
  facts.add({
    kind: "supertag-extension-add",
    supertagId: "supertag",
    baseSupertagId: "base-supertag",
    anchor: end,
  });
  return lifecycle(facts, {
    kind: "supertag-extension-remove",
    supertagId: "supertag",
    baseSupertagId: "base-supertag",
    previousAnchor: end,
  });
}

function supertagTemplateNodeAddCase(): ProposalLifecycleCase {
  const facts = supertagAndTemplateFacts();
  return lifecycle(facts, {
    kind: "supertag-template-node-add",
    supertagId: "supertag",
    templateNodeId: "template",
    templateOccurrenceId: "supertag-template-template-occurrence",
    anchor: end,
  });
}

function supertagTemplateNodeRemoveCase(): ProposalLifecycleCase {
  const facts = supertagAndTemplateFacts();
  facts.add({
    kind: "supertag-template-node-add",
    supertagId: "supertag",
    templateNodeId: "template",
    templateOccurrenceId: "supertag-template-template-occurrence",
    anchor: end,
  });
  return lifecycle(facts, {
    kind: "supertag-template-node-remove",
    supertagId: "supertag",
    templateNodeId: "template",
    templateOccurrenceId: "supertag-template-template-occurrence",
    previousAnchor: end,
  });
}

function templateNodeDetachCase(): ProposalLifecycleCase {
  const facts = supertagAndTemplateFacts();
  facts.add({
    kind: "supertag-template-node-add",
    supertagId: "supertag",
    templateNodeId: "template",
    templateOccurrenceId: "supertag-template-template-occurrence",
    anchor: end,
  });
  facts.add({ kind: "supertag-apply", nodeId: "node", supertagId: "supertag", anchor: end });
  return lifecycle(facts, {
    kind: "template-node-detach",
    ownerNodeId: "node",
    templateNodeId: "template",
    instanceNodeId: "template-instance:v1:node:template",
    instanceOccurrenceId: "template-instance-occ:v1:node:template",
    anchor: end,
    sourceSupertagIds: ["supertag"],
    sourceApplicationSupertagIds: ["supertag"],
    sourceTemplateOccurrenceIds: ["supertag-template-template-occurrence"],
  });
}

function supertagAndFieldFacts(): Facts {
  const facts = base();
  addDefinitionNode(facts, "supertag", SUPERTAG_DEFINITION_NODE_TYPE);
  addDefinitionNode(facts, "field", FIELD_DEFINITION_NODE_TYPE);
  return facts;
}

function supertagPairFacts(): Facts {
  const facts = base();
  addDefinitionNode(facts, "supertag", SUPERTAG_DEFINITION_NODE_TYPE);
  addDefinitionNode(facts, "base-supertag", SUPERTAG_DEFINITION_NODE_TYPE);
  return facts;
}

function supertagAndTemplateFacts(): Facts {
  const facts = base();
  addDefinitionNode(facts, "supertag", SUPERTAG_DEFINITION_NODE_TYPE);
  addPlacedNode(facts, "template");
  return facts;
}

function lifecycle(facts: Facts, mutation: Mutation): ProposalLifecycleCase {
  return { kind: mutation.kind, facts, proposal: facts.add(mutation, "proposal") };
}
