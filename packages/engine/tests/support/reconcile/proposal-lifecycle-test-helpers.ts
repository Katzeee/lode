import type { GraphAction, ProposableAction } from "../../../src/domain/fact/index.js";
import { base, end, Facts } from "./reconcile-test-helpers.js";
import { addPlacedNode } from "./placed-node-test-helpers.js";
import { fieldProposalLifecycleCases } from "./proposal-field-lifecycle-test-helpers.js";
import { supertagProposalLifecycleCases } from "./proposal-supertag-lifecycle-test-helpers.js";
import { inlineReferenceProposalLifecycleCases } from "./proposal-inline-reference-lifecycle-test-helpers.js";
import type { ProposalLifecycleCase } from "./proposal-lifecycle-types.js";
import { searchProposalLifecycleCases } from "./proposal-search-lifecycle-test-helpers.js";
import { templateFieldProposalLifecycleCases } from "./proposal-template-field-lifecycle-test-helpers.js";
import { viewProposalLifecycleCases } from "./proposal-view-lifecycle-test-helpers.js";
export type { ProposalLifecycleCase } from "./proposal-lifecycle-types.js";

export const proposalLifecycleCases = (): readonly ProposalLifecycleCase[] =>
  Object.values(PROPOSAL_LIFECYCLE_CASES).map((createCase) => createCase());

export const historyLifecycleCases = proposalLifecycleCases;

const PROPOSAL_LIFECYCLE_CASES = {
  "node-create": nodeCreateCase,
  "node-trash": nodeDeleteCase,
  "node-restore": nodeRestoreCase,
  "original-promote": originalPromoteCase,
  "placement-create": occurrenceCreateCase,
  "placement-remove": occurrenceDeleteCase,
  "placement-move": occurrenceMoveCase,
  ...supertagProposalLifecycleCases,
  ...fieldProposalLifecycleCases,
  ...inlineReferenceProposalLifecycleCases,
  ...templateFieldProposalLifecycleCases,
  ...searchProposalLifecycleCases,
  ...viewProposalLifecycleCases,
  "rich-text-splice": richTextSpliceCase,
  "rich-text-mark": richTextMarkCase,
} satisfies Readonly<Record<ProposableAction["kind"], () => ProposalLifecycleCase>>;

function nodeCreateCase(): ProposalLifecycleCase {
  const facts = new Facts();
  const proposal = facts.addPlaced("created", "workspace", "created-original", "proposal")[0];
  if (!proposal) {
    throw new Error("Expected a Node creation proposal");
  }
  return { kind: "node-create", facts, proposal };
}

function nodeDeleteCase(): ProposalLifecycleCase {
  const facts = base();
  return lifecycle(facts, { kind: "node-trash", nodeId: "node" });
}

function nodeRestoreCase(): ProposalLifecycleCase {
  const facts = base();
  facts.add({ kind: "node-trash", nodeId: "node" });
  return lifecycle(facts, {
    kind: "node-restore",
    nodeId: "node",
    placementId: "occurrence",
    parentNodeId: "workspace",
    anchor: end,
  });
}

function originalPromoteCase(): ProposalLifecycleCase {
  const facts = base();
  addReferencePlacement(facts);
  return lifecycle(facts, {
    kind: "original-promote",
    nodeId: "node",
    placementId: "reference",
  });
}

function occurrenceCreateCase(): ProposalLifecycleCase {
  const facts = base();
  return lifecycle(facts, {
    kind: "placement-create",
    placementId: "created-occurrence",
    nodeId: "node",
    parentNodeId: "node",
    anchor: end,
  });
}

function occurrenceDeleteCase(): ProposalLifecycleCase {
  const facts = base();
  addReferencePlacement(facts);
  return lifecycle(facts, {
    kind: "placement-remove",
    placementId: "reference",
  });
}

function addReferencePlacement(facts: Facts): void {
  addPlacedNode(facts, "reference-parent");
  facts.add({
    kind: "placement-create",
    placementId: "reference",
    nodeId: "node",
    parentNodeId: "reference-parent",
    anchor: end,
  });
}

function occurrenceMoveCase(): ProposalLifecycleCase {
  const facts = nestedOccurrenceBase();
  facts.add({ kind: "node-create", nodeId: "parent", ownerNodeId: "workspace", originalPlacement: null });
  facts.add({
    kind: "placement-create",
    placementId: "parent",
    nodeId: "parent",
    parentNodeId: "outline-root-node",
    anchor: end,
  });
  return lifecycle(facts, {
    kind: "placement-move",
    placementId: "occurrence",
    parentNodeId: "parent",
    anchor: end,
  });
}

function nestedOccurrenceBase(): Facts {
  const facts = new Facts();
  facts.add({ kind: "node-create", nodeId: "outline-root-node", ownerNodeId: "workspace", originalPlacement: null });
  facts.add({ kind: "node-create", nodeId: "node", ownerNodeId: "workspace", originalPlacement: null });
  facts.add({
    kind: "placement-create",
    placementId: "outline-root-occurrence",
    nodeId: "outline-root-node",
    parentNodeId: "workspace",
    anchor: end,
  });
  facts.add({
    kind: "placement-create",
    placementId: "occurrence",
    nodeId: "node",
    parentNodeId: "outline-root-node",
    anchor: end,
  });
  return facts;
}

function richTextSpliceCase(): ProposalLifecycleCase {
  return lifecycle(base(), {
    kind: "rich-text-splice",
    nodeId: "node",
    deleteAtomIds: [],
    anchor: end,
    insert: "proposal",
  });
}

function richTextMarkCase(): ProposalLifecycleCase {
  const facts = base();
  const text = facts.add({
    kind: "rich-text-splice",
    nodeId: "node",
    deleteAtomIds: [],
    anchor: end,
    insert: "A",
  });
  return lifecycle(facts, {
    kind: "rich-text-mark",
    nodeId: "node",
    atomIds: [`${text.id}#0`],
    key: "bold",
    value: { kind: "set", value: true },
  });
}

function lifecycle(facts: Facts, authoredAction: GraphAction): ProposalLifecycleCase {
  return { kind: authoredAction.kind, facts, proposal: facts.add(authoredAction, "proposal") };
}
