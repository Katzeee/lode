import type { Fact, Mutation } from "../fact/index.js";
import { base, end, Facts } from "./reconcile-test-helpers.js";
import { fieldProposalLifecycleCases } from "./proposal-field-lifecycle-test-helpers.js";
import { schemaProposalLifecycleCases } from "./proposal-schema-lifecycle-test-helpers.js";

export type ProposalLifecycleCase = Readonly<{
  kind: Mutation["kind"];
  facts: Facts;
  proposal: Fact;
}>;

export function proposalLifecycleCases(): readonly ProposalLifecycleCase[] {
  return Object.values(PROPOSAL_LIFECYCLE_CASES).map((createCase) => createCase());
}

export function historyLifecycleCases(): readonly ProposalLifecycleCase[] {
  return proposalLifecycleCases().filter((entry) => HISTORY_MUTATION_KINDS.has(entry.kind));
}

const HISTORY_MUTATION_KINDS: ReadonlySet<Mutation["kind"]> = new Set([
  "node-create",
  "node-delete",
  "node-restore",
  "occurrence-create",
  "occurrence-delete",
  "occurrence-restore",
  "occurrence-move",
  "canonical-occurrence-set",
  "schema-apply",
  "schema-remove",
  "schema-field-add",
  "schema-field-remove",
  "schema-field-configure",
  "schema-extension-add",
  "schema-extension-remove",
  "schema-template-node-add",
  "schema-template-node-remove",
  "field-value-delete",
  "materialized-field-delete",
  "text-splice",
  "text-mark",
  "value-set",
  "value-unset",
]);

const PROPOSAL_LIFECYCLE_CASES = {
  "node-create": nodeCreateCase,
  "node-delete": nodeDeleteCase,
  "node-restore": nodeRestoreCase,
  "occurrence-create": occurrenceCreateCase,
  "occurrence-delete": occurrenceDeleteCase,
  "occurrence-restore": occurrenceRestoreCase,
  "occurrence-move": occurrenceMoveCase,
  "canonical-occurrence-set": canonicalCase,
  ...schemaProposalLifecycleCases,
  ...fieldProposalLifecycleCases,
  "text-splice": textSpliceCase,
  "text-mark": textMarkCase,
  "value-set": valueSetCase,
  "value-unset": valueUnsetCase,
} satisfies Record<Mutation["kind"], () => ProposalLifecycleCase>;

function nodeCreateCase(): ProposalLifecycleCase {
  const facts = new Facts();
  return lifecycle(facts, { kind: "node-create", nodeId: "created" });
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
    parentOccurrenceId: "occurrence",
    parentPolicy: "cascade",
    anchor: end,
  });
}

function occurrenceDeleteCase(): ProposalLifecycleCase {
  const facts = base();
  return lifecycle(facts, {
    kind: "occurrence-delete",
    occurrenceId: "occurrence",
    childPolicy: "rehome",
    previousParentOccurrenceId: null,
    previousAnchor: end,
  });
}

function occurrenceRestoreCase(): ProposalLifecycleCase {
  const facts = base();
  const deletion = facts.add({
    kind: "occurrence-delete",
    occurrenceId: "occurrence",
    childPolicy: "rehome",
  });
  return lifecycle(facts, {
    kind: "occurrence-restore",
    occurrenceId: "occurrence",
    deletionFactId: deletion.id,
    parentOccurrenceId: null,
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
    parentOccurrenceId: "workspace-root",
    parentPolicy: "cascade",
    anchor: end,
  });
  return lifecycle(facts, {
    kind: "occurrence-move",
    occurrenceId: "occurrence",
    parentOccurrenceId: "parent",
    anchor: end,
    previousParentOccurrenceId: "workspace-root",
    previousAnchor: end,
  });
}

function canonicalCase(): ProposalLifecycleCase {
  const facts = base();
  facts.add({
    kind: "occurrence-create",
    occurrenceId: "reference",
    nodeId: "node",
    parentOccurrenceId: "occurrence",
    parentPolicy: "cascade",
    anchor: end,
  });
  return lifecycle(facts, {
    kind: "canonical-occurrence-set",
    nodeId: "node",
    occurrenceId: "reference",
    previousOccurrenceId: "occurrence",
  });
}

function nestedOccurrenceBase(): Facts {
  const facts = new Facts();
  facts.add({ kind: "node-create", nodeId: "workspace-root-node" });
  facts.add({ kind: "node-create", nodeId: "node" });
  facts.add({
    kind: "occurrence-create",
    occurrenceId: "workspace-root",
    nodeId: "workspace-root-node",
    parentOccurrenceId: null,
    parentPolicy: "cascade",
    anchor: end,
  });
  facts.add({
    kind: "occurrence-create",
    occurrenceId: "occurrence",
    nodeId: "node",
    parentOccurrenceId: "workspace-root",
    parentPolicy: "cascade",
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

function valueSetCase(): ProposalLifecycleCase {
  return lifecycle(base(), {
    kind: "value-set",
    owner: { kind: "field", id: "field" },
    namespace: "metadata",
    key: "label",
    value: "Proposal",
    previous: { kind: "unset" },
  });
}

function valueUnsetCase(): ProposalLifecycleCase {
  const facts = base();
  facts.add({
    kind: "value-set",
    owner: { kind: "node", id: "node" },
    namespace: "property",
    key: "color",
    value: "blue",
  });
  return lifecycle(facts, {
    kind: "value-unset",
    owner: { kind: "node", id: "node" },
    namespace: "property",
    key: "color",
    previous: { kind: "set", value: "blue" },
  });
}

function lifecycle(facts: Facts, mutation: Mutation): ProposalLifecycleCase {
  return { kind: mutation.kind, facts, proposal: facts.add(mutation, "proposal") };
}
