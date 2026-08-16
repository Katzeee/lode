import { factObserves, type ContributionFact, type Mutation } from "../fact/index.js";
import {
  addFieldInitializationSupport,
  addTemplateDetachmentSupport,
  type SupertagSupportContext,
} from "./supertag-support.js";
import { addIfPresent, effectiveCandidate } from "./support-candidate.js";

type ExistenceSupport = Readonly<{
  nodes: Map<string, string[]>;
  occurrences: Map<string, string[]>;
  viable: Set<string>;
}>;

type OccurrenceLifecycleFacts = ReadonlyMap<string, readonly ContributionFact[]>;

export function addInitializationSupport(
  support: Set<string>,
  mutation: Extract<Mutation, { kind: "field-initialize" }>,
  fact: ContributionFact,
  supertagSupport: SupertagSupportContext,
  existence: ExistenceSupport,
): void {
  addFieldInitializationSupport(support, mutation, fact, supertagSupport);
  for (const nodeId of [
    mutation.fieldNodeId,
    ...mutation.values.flatMap((value) => (value.kind === "text" ? [value.nodeId] : [])),
  ]) {
    addIfPresent(support, effectiveCandidate(existence.nodes, nodeId, existence.viable));
  }
  for (const occurrenceId of [mutation.fieldOccurrenceId, ...mutation.values.map((value) => value.occurrenceId)]) {
    addIfPresent(support, effectiveCandidate(existence.occurrences, occurrenceId, existence.viable));
  }
}

export function addTemplateNodeSupport(
  support: Set<string>,
  mutation: Extract<Mutation, { kind: "template-node-detach" }>,
  fact: ContributionFact,
  supertagSupport: SupertagSupportContext,
  existence: ExistenceSupport,
): void {
  addTemplateDetachmentSupport(support, mutation, fact, supertagSupport);
  addIfPresent(support, effectiveCandidate(existence.nodes, mutation.instanceNodeId, existence.viable));
}

export function addGeneratedOccurrenceSupport(
  support: Set<string>,
  mutation: Mutation,
  fact: ContributionFact,
  lifecycleFacts: OccurrenceLifecycleFacts,
): void {
  const expected = generatedOccurrenceEffect(mutation);
  if (expected === null) {
    return;
  }
  const candidate = lifecycleFacts
    .get(`${expected.kind}/${expected.occurrenceId}`)
    ?.find((lifecycle) => factObserves(lifecycle, fact));
  if (candidate !== undefined) {
    support.add(candidate.id);
  }
}

function generatedOccurrenceEffect(
  mutation: Mutation,
): Readonly<{ kind: "occurrence-create" | "occurrence-delete"; occurrenceId: string }> | null {
  if (mutation.kind === "supertag-field-remove") {
    return { kind: "occurrence-delete", occurrenceId: mutation.fieldOccurrenceId };
  }
  if (mutation.kind === "supertag-template-node-remove") {
    return { kind: "occurrence-delete", occurrenceId: mutation.templateOccurrenceId };
  }
  if (mutation.kind === "field-value-delete") {
    return { kind: "occurrence-delete", occurrenceId: mutation.valueOccurrenceId };
  }
  if (mutation.kind === "materialized-field-delete") {
    return { kind: "occurrence-delete", occurrenceId: mutation.fieldOccurrenceId };
  }
  return mutation.kind === "template-node-detach"
    ? { kind: "occurrence-create", occurrenceId: mutation.instanceOccurrenceId }
    : null;
}
