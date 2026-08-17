import type {
  MetanodeMutation,
  Mutation,
  SearchExpressionMutation,
  SupertagMutation,
  ViewMutation,
} from "../../../src/domain/fact/index.js";
import { base, end, Facts } from "./reconcile-test-helpers.js";
import { addPlacedNode } from "./placed-node-test-helpers.js";
import { fieldProposalLifecycleCases } from "./proposal-field-lifecycle-test-helpers.js";
import { supertagProposalLifecycleCases } from "./proposal-supertag-lifecycle-test-helpers.js";
import { viewProposalLifecycleCases } from "./proposal-view-lifecycle-test-helpers.js";
import { inlineReferenceProposalLifecycleCases } from "./proposal-inline-reference-lifecycle-test-helpers.js";
import type { ProposalLifecycleCase } from "./proposal-lifecycle-types.js";
export type { ProposalLifecycleCase } from "./proposal-lifecycle-types.js";

export const proposalLifecycleCases = (): readonly ProposalLifecycleCase[] =>
  Object.values(PROPOSAL_LIFECYCLE_CASES).map((createCase) => createCase());

export const historyLifecycleCases = (): readonly ProposalLifecycleCase[] =>
  proposalLifecycleCases().filter((entry) => HISTORY_MUTATION_KINDS.has(entry.kind));

const HISTORY_MUTATION_KINDS: ReadonlySet<Mutation["kind"]> = new Set([
  "node-create",
  "node-delete",
  "node-restore",
  "occurrence-create",
  "occurrence-delete",
  "occurrence-restore",
  "occurrence-move",
  "node-owner-set",
  "supertag-apply",
  "supertag-remove",
  "supertag-extension-add",
  "supertag-extension-remove",
  "supertag-template-node-add",
  "supertag-template-node-remove",
  "field-value-delete",
  "materialized-field-delete",
  "field-datatype-configure",
  "field-cardinality-configure",
  "field-optionality-configure",
  "text-splice",
  "text-mark",
  "inline-reference-create",
  "inline-reference-delete",
  "inline-reference-alias-attach",
  "inline-reference-alias-detach",
  "shared-default-view-definition-mode-set",
]);

const PROPOSAL_LIFECYCLE_CASES = {
  "node-create": nodeCreateCase,
  "node-delete": nodeDeleteCase,
  "node-restore": nodeRestoreCase,
  "occurrence-create": occurrenceCreateCase,
  "occurrence-delete": occurrenceDeleteCase,
  "occurrence-restore": occurrenceRestoreCase,
  "occurrence-move": occurrenceMoveCase,
  "node-owner-set": nodeOwnerCase,
  "intrinsic-node-type-declare": declareIntrinsicNodeTypeCase,
  ...supertagProposalLifecycleCases,
  ...fieldProposalLifecycleCases,
  ...viewProposalLifecycleCases,
  ...inlineReferenceProposalLifecycleCases,
  "text-splice": textSpliceCase,
  "text-mark": textMarkCase,
} satisfies Record<
  Exclude<
    Mutation,
    | MetanodeMutation
    | SearchExpressionMutation
    | Extract<
        SupertagMutation,
        {
          kind:
            | "supertag-template-field-attach"
            | "supertag-template-field-existing-attach"
            | "supertag-template-field-detach"
            | "supertag-template-field-discoverability-set"
            | "supertag-template-field-visibility-configure"
            | "supertag-optional-field-contribution-attach"
            | "supertag-optional-field-contribution-detach";
        }
      >
    | Extract<
        ViewMutation,
        {
          kind:
            | "shared-default-view-definition-attach"
            | "shared-default-view-definition-detach"
            | "shared-default-view-definition-options-set"
            | "shared-default-view-definition-sort-by-name-set";
        }
      >
  >["kind"],
  () => ProposalLifecycleCase
>;

function declareIntrinsicNodeTypeCase(): ProposalLifecycleCase {
  const facts = base();
  return lifecycle(facts, {
    kind: "intrinsic-node-type-declare",
    nodeId: "node",
    intrinsicNodeType: "supertag-definition",
  });
}

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
  return lifecycle(facts, { kind: "node-delete", nodeId: "node" });
}

function nodeRestoreCase(): ProposalLifecycleCase {
  const facts = base();
  const deletion = facts.add({ kind: "node-delete", nodeId: "node" });
  return lifecycle(facts, {
    kind: "node-restore",
    nodeId: "node",
    deletionFactId: deletion.id,
  });
}

function occurrenceCreateCase(): ProposalLifecycleCase {
  const facts = base();
  return lifecycle(facts, {
    kind: "occurrence-create",
    occurrenceId: "created-occurrence",
    nodeId: "node",
    parentNodeId: "node",
    anchor: end,
  });
}

function occurrenceDeleteCase(): ProposalLifecycleCase {
  const facts = base();
  addReferencePlacement(facts);
  return lifecycle(facts, {
    kind: "occurrence-delete",
    occurrenceId: "reference",
    previousParentNodeId: "reference-parent",
    previousAnchor: { ...end, fallback: "start" },
  });
}

function occurrenceRestoreCase(): ProposalLifecycleCase {
  const facts = base();
  addReferencePlacement(facts);
  const deletion = facts.add({
    kind: "occurrence-delete",
    occurrenceId: "reference",
    previousParentNodeId: "reference-parent",
    previousAnchor: { ...end, fallback: "start" },
  });
  return lifecycle(facts, {
    kind: "occurrence-restore",
    occurrenceId: "reference",
    deletionFactId: deletion.id,
    parentNodeId: "reference-parent",
    anchor: end,
  });
}

function addReferencePlacement(facts: Facts): void {
  addPlacedNode(facts, "reference-parent");
  facts.add({
    kind: "occurrence-create",
    occurrenceId: "reference",
    nodeId: "node",
    parentNodeId: "reference-parent",
    anchor: end,
  });
}

function occurrenceMoveCase(): ProposalLifecycleCase {
  const facts = nestedOccurrenceBase();
  facts.add({ kind: "node-create", nodeId: "parent" });
  facts.add({
    kind: "occurrence-create",
    occurrenceId: "parent",
    nodeId: "parent",
    parentNodeId: "outline-root-node",
    anchor: end,
  });
  return lifecycle(facts, {
    kind: "occurrence-move",
    occurrenceId: "occurrence",
    parentNodeId: "parent",
    anchor: end,
    previousParentNodeId: "outline-root-node",
    previousAnchor: end,
  });
}

function nodeOwnerCase(): ProposalLifecycleCase {
  const facts = base();
  addPlacedNode(facts, "reference-parent");
  facts.add({
    kind: "occurrence-create",
    occurrenceId: "reference",
    nodeId: "node",
    parentNodeId: "reference-parent",
    anchor: end,
  });
  return lifecycle(facts, {
    kind: "node-owner-set",
    nodeId: "node",
    ownerNodeId: "reference-parent",
    previousOwnerNodeId: "workspace",
  });
}

function nestedOccurrenceBase(): Facts {
  const facts = new Facts();
  facts.add({ kind: "node-create", nodeId: "outline-root-node" });
  facts.add({ kind: "node-create", nodeId: "node" });
  facts.add({
    kind: "occurrence-create",
    occurrenceId: "outline-root-occurrence",
    nodeId: "outline-root-node",
    parentNodeId: "workspace",
    anchor: end,
  });
  facts.add({
    kind: "occurrence-create",
    occurrenceId: "occurrence",
    nodeId: "node",
    parentNodeId: "outline-root-node",
    anchor: end,
  });
  return facts;
}

function textSpliceCase(): ProposalLifecycleCase {
  return lifecycle(base(), {
    kind: "text-splice",
    nodeId: "node",
    deleteAtomIds: [],
    deletedAtoms: [],
    anchor: end,
    insert: "proposal",
  });
}

function textMarkCase(): ProposalLifecycleCase {
  const facts = base();
  const text = facts.add({
    kind: "text-splice",
    nodeId: "node",
    deleteAtomIds: [],
    anchor: end,
    insert: "A",
  });
  return lifecycle(facts, {
    kind: "text-mark",
    nodeId: "node",
    atomIds: [`${text.id}#0`],
    key: "bold",
    value: { kind: "set", value: true },
    previous: { kind: "unset" },
  });
}

function lifecycle(facts: Facts, mutation: Mutation): ProposalLifecycleCase {
  return { kind: mutation.kind, facts, proposal: facts.add(mutation, "proposal") };
}
