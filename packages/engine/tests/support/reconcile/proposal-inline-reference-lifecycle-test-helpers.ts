import type { Mutation } from "../../../src/domain/fact/index.js";
import { base, end, type Facts } from "./reconcile-test-helpers.js";
import { addPlacedNode } from "./placed-node-test-helpers.js";
import type { ProposalLifecycleCase } from "./proposal-lifecycle-types.js";

export const inlineReferenceProposalLifecycleCases = {
  "inline-reference-create": inlineReferenceCreateCase,
  "inline-reference-delete": inlineReferenceDeleteCase,
  "inline-reference-alias-attach": inlineReferenceAliasAttachCase,
  "inline-reference-alias-detach": inlineReferenceAliasDetachCase,
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

function inlineReferenceDeleteCase(): ProposalLifecycleCase {
  const facts = inlineReferenceBase(true);
  return lifecycle(facts, {
    kind: "inline-reference-delete",
    inlineReferenceId: "inline-reference",
    previousHostNodeId: "node",
    previousTargetNodeId: "target",
    previousAnchor: end,
  });
}

function inlineReferenceAliasAttachCase(): ProposalLifecycleCase {
  return lifecycle(inlineAliasBase(false), {
    kind: "inline-reference-alias-attach",
    inlineReferenceId: "inline-reference",
    aliasNodeId: "inline-alias",
  });
}

function inlineReferenceAliasDetachCase(): ProposalLifecycleCase {
  return lifecycle(inlineAliasBase(true), {
    kind: "inline-reference-alias-detach",
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
  facts.addTransaction([
    { kind: "node-create", nodeId: "node-configuration" },
    { kind: "metanode-attach", hostNodeId: "node", metanodeId: "node-configuration" },
    { kind: "node-create", nodeId: "inline-alias" },
    {
      kind: "occurrence-create",
      occurrenceId: "inline-alias-occurrence",
      nodeId: "inline-alias",
      parentNodeId: "node-configuration",
      anchor: end,
    },
  ]);
  if (withAlias) {
    facts.add({
      kind: "inline-reference-alias-attach",
      inlineReferenceId: "inline-reference",
      aliasNodeId: "inline-alias",
    });
  }
  return facts;
}

function lifecycle(facts: Facts, mutation: Mutation): ProposalLifecycleCase {
  return { kind: mutation.kind, facts, proposal: facts.add(mutation, "proposal") };
}
