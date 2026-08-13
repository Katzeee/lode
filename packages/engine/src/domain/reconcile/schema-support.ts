import { compareFacts, type ContributionFact, type Mutation } from "../fact/index.js";

export function addSchemaMutationSupport(
  support: Set<string>,
  mutation: Extract<Mutation, { kind: `schema-${string}` }>,
  fact: ContributionFact,
  context: SchemaSupportContext,
): void {
  if (mutation.kind === "schema-apply" || mutation.kind === "schema-remove") {
    addCandidateSupport(support, context.nodes, mutation.nodeId, context.viable);
  } else if (
    mutation.kind === "schema-extension-add" ||
    mutation.kind === "schema-extension-remove"
  ) {
    addCandidateSupport(support, context.nodes, mutation.baseSchemaId, context.viable);
  } else if (
    mutation.kind === "schema-template-node-add" ||
    mutation.kind === "schema-template-node-remove"
  ) {
    addCandidateSupport(support, context.nodes, mutation.templateNodeId, context.viable);
    if (mutation.kind === "schema-template-node-remove") {
      const binding = latestObservedCandidate(
        context.templateOccurrences.get(mutation.templateOccurrenceId) ?? [],
        fact,
      );
      if (binding !== null) {
        support.add(binding.id);
      }
    }
  } else {
    addCandidateSupport(support, context.nodes, mutation.fieldDefinitionId, context.viable);
    if (mutation.kind === "schema-field-configure" || mutation.kind === "schema-field-remove") {
      addCandidateSupport(support, context.nodes, mutation.fieldNodeId, context.viable);
    }
  }
  addCandidateSupport(support, context.nodes, mutation.schemaId, context.viable);
  if (mutation.kind === "schema-apply") {
    const key = schemaApplicationKey(mutation.nodeId, mutation.schemaId);
    const values = context.applications.get(key) ?? [];
    values.push(fact);
    context.applications.set(key, values);
  } else if (mutation.kind === "schema-template-node-add") {
    const key = mutation.templateOccurrenceId;
    const values = context.templateOccurrences.get(key) ?? [];
    values.push(fact);
    context.templateOccurrences.set(key, values);
  }
}

export function addTemplateDetachmentSupport(
  support: Set<string>,
  mutation: Extract<Mutation, { kind: "template-node-detach" }>,
  fact: ContributionFact,
  context: SchemaSupportContext,
): void {
  addCandidateSupport(support, context.nodes, mutation.ownerNodeId, context.viable);
  addCandidateSupport(support, context.nodes, mutation.templateNodeId, context.viable);
  for (const templateOccurrenceId of mutation.sourceTemplateOccurrenceIds ?? []) {
    const item = latestObservedCandidate(
      context.templateOccurrences.get(templateOccurrenceId) ?? [],
      fact,
    );
    if (item !== null) {
      support.add(item.id);
    }
  }
  for (const appliedSchemaId of mutation.sourceApplicationSchemaIds ?? []) {
    const application = latestObservedCandidate(
      context.applications.get(schemaApplicationKey(mutation.ownerNodeId, appliedSchemaId)) ?? [],
      fact,
    );
    if (application !== null) {
      support.add(application.id);
    }
  }
}

export function addFieldInitializationSupport(
  support: Set<string>,
  mutation: Extract<Mutation, { kind: "field-initialize" }>,
  fact: ContributionFact,
  context: SchemaSupportContext,
): void {
  for (const nodeId of [
    mutation.ownerNodeId,
    mutation.schemaId,
    mutation.fieldDefinitionId,
    ...mutation.values.flatMap((value) => (value.kind === "reference" ? [value.nodeId] : [])),
  ]) {
    addCandidateSupport(support, context.nodes, nodeId, context.viable);
  }
  const application = latestObservedCandidate(
    context.applications.get(schemaApplicationKey(mutation.ownerNodeId, mutation.schemaId)) ?? [],
    fact,
  );
  if (application !== null) {
    support.add(application.id);
  }
}

export type SchemaSupportContext = Readonly<{
  nodes: ReadonlyMap<string, readonly string[]>;
  viable: ReadonlySet<string>;
  applications: Map<string, ContributionFact[]>;
  templateOccurrences: Map<string, ContributionFact[]>;
}>;

function schemaApplicationKey(nodeId: string, schemaId: string): string {
  return JSON.stringify([nodeId, schemaId]);
}

function latestObservedCandidate(
  candidates: readonly ContributionFact[],
  observer: ContributionFact,
): ContributionFact | null {
  return (
    candidates
      .filter((candidate) => {
        const { replicaId, sequence } = candidate.coordinate.dot;
        return (observer.coordinate.observed[replicaId] ?? 0) >= sequence;
      })
      .sort(compareFacts)
      .at(-1) ?? null
  );
}

function addCandidateSupport(
  support: Set<string>,
  candidates: ReadonlyMap<string, readonly string[]>,
  identity: string,
  viable: ReadonlySet<string>,
): void {
  const values = candidates.get(identity);
  const candidate = values?.find((id) => viable.has(id)) ?? values?.[0];
  if (candidate !== undefined) {
    support.add(candidate);
  }
}
