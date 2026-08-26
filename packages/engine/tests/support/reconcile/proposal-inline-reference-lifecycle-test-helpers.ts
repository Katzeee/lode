import type { GraphAction } from "../../../src/domain/fact/index.js";
import { base, end, type Facts } from "./reconcile-test-helpers.js";
import { addPlacedNode } from "./placed-node-test-helpers.js";
import type { ProposalLifecycleCase } from "./proposal-lifecycle-types.js";

export const inlineReferenceProposalLifecycleCases = {
  "inline-reference-create": inlineReferenceCreateCase,
  "inline-reference-remove": inlineReferenceRemoveCase,
  "inline-alias-attach": inlineAliasAttachCase,
  "inline-alias-detach": inlineAliasDetachCase,
} as const;

function inlineReferenceCreateCase(): ProposalLifecycleCase {
  const facts = inlineReferenceBase(false);
  return lifecycle(facts, {
    kind: "inline-reference-create",
    inlineReferenceId: "inline-reference",
    hostNodeId: "node",
    targetNodeId: "target",
    anchor: end,
  });
}

function inlineReferenceRemoveCase(): ProposalLifecycleCase {
  const facts = inlineReferenceBase(true);
  return lifecycle(facts, {
    kind: "inline-reference-remove",
    inlineReferenceId: "inline-reference",
  });
}

function inlineAliasAttachCase(): ProposalLifecycleCase {
  return lifecycle(inlineAliasBase(false), {
    kind: "inline-alias-attach",
    inlineReferenceId: "inline-reference",
    aliasNodeId: "inline-alias",
  });
}

function inlineAliasDetachCase(): ProposalLifecycleCase {
  return lifecycle(inlineAliasBase(true), {
    kind: "inline-alias-detach",
    inlineReferenceId: "inline-reference",
    aliasNodeId: "inline-alias",
  });
}

function inlineReferenceBase(withReference: boolean): Facts {
  const facts = base();
  addPlacedNode(facts, "target");
  if (withReference) {
    facts.add({
      kind: "inline-reference-create",
      inlineReferenceId: "inline-reference",
      hostNodeId: "node",
      targetNodeId: "target",
      anchor: end,
    });
  }
  return facts;
}

function inlineAliasBase(withAlias: boolean): Facts {
  const facts = inlineReferenceBase(true);
  facts.addTransaction([{ kind: "node-create", nodeId: "inline-alias", ownerNodeId: "node", originalPlacement: null }]);
  if (withAlias) {
    facts.add({
      kind: "inline-alias-attach",
      inlineReferenceId: "inline-reference",
      aliasNodeId: "inline-alias",
    });
  }
  return facts;
}

function lifecycle(facts: Facts, authoredAction: GraphAction): ProposalLifecycleCase {
  return { kind: authoredAction.kind, facts, proposal: facts.add(authoredAction, "proposal") };
}
