import { SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE, type GraphAction } from "../../../src/domain/fact/index.js";
import type { ProposalLifecycleCase } from "./proposal-lifecycle-types.js";
import { base, end } from "./reconcile-test-helpers.js";
import { addDefinitionNode } from "./placed-node-test-helpers.js";
import type { Facts } from "./reconcile-test-helpers.js";

export const supertagProposalLifecycleCases = {
  "supertag-application-add": supertagApplyCase,
  "supertag-membership-remove": supertagRemoveCase,
  "supertag-extension-add": supertagExtensionAddCase,
  "supertag-extension-remove": supertagExtensionRemoveCase,
  "template-node-detach": templateNodeDetachCase,
} as const;

function supertagApplyCase(): ProposalLifecycleCase {
  const facts = base();
  addDefinitionNode(facts, "supertag", SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE);
  return { kind: "supertag-application-add", facts, proposal: facts.applySupertag("node", "supertag", "proposal") };
}

function supertagRemoveCase(): ProposalLifecycleCase {
  const facts = base();
  addDefinitionNode(facts, "supertag", SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE);
  facts.applySupertag("node", "supertag");
  return { kind: "supertag-membership-remove", facts, proposal: facts.removeSupertag("node", "supertag", "proposal") };
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
  });
}

function templateNodeDetachCase(): ProposalLifecycleCase {
  const facts = supertagAndTemplateFacts();
  facts.applySupertag("node", "supertag");
  return lifecycle(facts, {
    referenceCopies: [],
    copies: [
      {
        sourceNodeId: "template",
        sourcePath: [],
        instanceNodeId: "template-instance:v1:node:template",
        instanceOccurrenceId: "template-instance-occ:v1:node:template",
      },
    ],
    kind: "template-node-detach",
    sources: [{ supertagId: "supertag", appliedSupertagId: "supertag", templateOccurrenceId: "template-original" }],
    ownerNodeId: "node",
    templateNodeId: "template",
    instanceNodeId: "template-instance:v1:node:template",
    instanceOccurrenceId: "template-instance-occ:v1:node:template",
    anchor: end,
  });
}

function supertagPairFacts(): Facts {
  const facts = base();
  addDefinitionNode(facts, "supertag", SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE);
  addDefinitionNode(facts, "base-supertag", SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE);
  return facts;
}

function supertagAndTemplateFacts(): Facts {
  const facts = base();
  addDefinitionNode(facts, "supertag", SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE);
  facts.addPlaced("template", "supertag", "template-original");
  return facts;
}

function lifecycle(facts: Facts, authoredAction: GraphAction): ProposalLifecycleCase {
  return { kind: authoredAction.kind, facts, proposal: facts.add(authoredAction, "proposal") };
}
