import type { Mutation } from "../../../src/domain/fact/index.js";
import { base, end, type Facts } from "./reconcile-test-helpers.js";
import type { ProposalLifecycleCase } from "./proposal-lifecycle-types.js";

export const viewProposalLifecycleCases = {
  "shared-default-view-definition-mode-set": viewDefinitionModeSetCase,
} as const;

function viewDefinitionModeSetCase(): ProposalLifecycleCase {
  const facts = base();
  facts.addTransaction([
    { kind: "node-create", nodeId: "node-configuration" },
    { kind: "metanode-attach", hostNodeId: "node", metanodeId: "node-configuration" },
    { kind: "node-create", nodeId: "view-definition" },
    {
      kind: "occurrence-create",
      occurrenceId: "view-definition-occurrence",
      nodeId: "view-definition",
      parentNodeId: "node-configuration",
      anchor: end,
    },
    {
      kind: "shared-default-view-definition-attach",
      hostNodeId: "node",
      viewDefinitionNodeId: "view-definition",
      viewDefinitionOccurrenceId: "view-definition-occurrence",
    },
  ]);
  const mode = facts.add({
    kind: "shared-default-view-definition-mode-set",
    viewDefinitionNodeId: "view-definition",
    viewType: "outline",
    previousViewType: null,
    observedModeFactIds: [],
  });
  return lifecycle(facts, {
    kind: "shared-default-view-definition-mode-set",
    viewDefinitionNodeId: "view-definition",
    viewType: "table",
    previousViewType: "outline",
    observedModeFactIds: [mode.id],
  });
}

function lifecycle(facts: Facts, mutation: Mutation): ProposalLifecycleCase {
  return { kind: mutation.kind, facts, proposal: facts.add(mutation, "proposal") };
}
