import {
  compareFacts,
  factObserves,
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  mutationRelations,
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
  type ContributionFact,
  type Mutation,
  type IntrinsicNodeType,
  type SupertagMutation,
} from "../fact/index.js";

export function addSupertagMutationSupport(
  support: Set<string>,
  mutation: SupertagMutation,
  fact: ContributionFact,
  context: SupertagSupportContext,
): void {
  if (mutation.kind === "supertag-apply" || mutation.kind === "supertag-remove") {
    addCandidateSupport(support, context.nodes, mutation.hostNodeId, context.viable);
    addCandidateSupport(support, context.nodes, mutation.applicationNodeId, context.viable);
  } else if (mutation.kind === "supertag-template-node-add" || mutation.kind === "supertag-template-node-remove") {
    addCandidateSupport(support, context.nodes, mutation.templateNodeId, context.viable);
    if (mutation.kind === "supertag-template-node-remove") {
      const binding = latestObservedCandidate(
        context.templateOccurrences.get(mutation.templateOccurrenceId) ?? [],
        fact,
      );
      if (binding !== null) {
        support.add(binding.id);
      }
    }
  } else if (mutation.kind === "supertag-template-field-discoverability-set") {
    addCandidateSupport(support, context.nodes, mutation.templateFieldNodeId, context.viable);
    addCandidateSupport(support, context.nodes, mutation.fieldDefinitionId, context.viable);
  } else if (mutation.kind === "supertag-template-field-visibility-configure") {
    addCandidateSupport(support, context.nodes, mutation.templateFieldNodeId, context.viable);
    addCandidateSupport(support, context.nodes, mutation.fieldDefinitionId, context.viable);
    mutation.observedVisibilityFactIds?.forEach((id) => support.add(id));
  } else if (
    mutation.kind === "supertag-template-field-attach" ||
    mutation.kind === "supertag-template-field-existing-attach" ||
    mutation.kind === "supertag-template-field-detach"
  ) {
    for (const nodeId of [
      mutation.templateFieldNodeId,
      mutation.fieldDefinitionId,
      mutation.staticDefaultValueNodeId,
    ]) {
      addCandidateSupport(support, context.nodes, nodeId, context.viable);
    }
  } else if (
    mutation.kind === "supertag-optional-field-contribution-attach" ||
    mutation.kind === "supertag-optional-field-contribution-detach"
  ) {
    for (const nodeId of [
      mutation.fieldNurseryNodeId,
      mutation.nurseryValueNodeId,
      mutation.contributionNodeId,
      mutation.fieldDefinitionId,
      mutation.valueNodeId,
    ]) {
      addCandidateSupport(support, context.nodes, nodeId, context.viable);
    }
  }
  const relations = mutationRelations(mutation);
  for (const supertagId of relations.supertagIds) {
    addCandidateSupport(support, context.nodes, supertagId, context.viable);
    addIntrinsicNodeTypeSupport(support, context, supertagId, SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE);
  }
  for (const fieldDefinitionId of relations.fieldDefinitionIds) {
    addCandidateSupport(support, context.nodes, fieldDefinitionId, context.viable);
    addIntrinsicNodeTypeSupport(support, context, fieldDefinitionId, FIELD_DEFINITION_INTRINSIC_NODE_TYPE);
  }
  if (mutation.kind === "supertag-apply") {
    const key = supertagApplicationKey(mutation.hostNodeId, mutation.supertagId);
    const values = context.applications.get(key) ?? [];
    values.push(fact);
    context.applications.set(key, values);
  } else if (mutation.kind === "supertag-template-node-add") {
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
  context: SupertagSupportContext,
): void {
  addCandidateSupport(support, context.nodes, mutation.ownerNodeId, context.viable);
  addCandidateSupport(support, context.nodes, mutation.templateNodeId, context.viable);
  for (const templateOccurrenceId of mutation.sourceTemplateOccurrenceIds ?? []) {
    const item = latestObservedCandidate(context.templateOccurrences.get(templateOccurrenceId) ?? [], fact);
    if (item !== null) {
      support.add(item.id);
    }
  }
  for (const appliedSupertagId of mutation.sourceApplicationSupertagIds ?? []) {
    const application = latestObservedCandidate(
      context.applications.get(supertagApplicationKey(mutation.ownerNodeId, appliedSupertagId)) ?? [],
      fact,
    );
    if (application !== null) {
      support.add(application.id);
    }
  }
}

export type SupertagSupportContext = Readonly<{
  nodes: ReadonlyMap<string, readonly string[]>;
  viable: ReadonlySet<string>;
  applications: Map<string, ContributionFact[]>;
  templateOccurrences: Map<string, ContributionFact[]>;
  intrinsicNodeTypeDeclarations: Map<string, string[]>;
}>;

export function intrinsicNodeTypeSupportKey(nodeId: string, intrinsicNodeType: IntrinsicNodeType): string {
  return JSON.stringify([nodeId, intrinsicNodeType]);
}

function addIntrinsicNodeTypeSupport(
  support: Set<string>,
  context: SupertagSupportContext,
  nodeId: string,
  intrinsicNodeType: IntrinsicNodeType,
): void {
  addCandidateSupport(
    support,
    context.intrinsicNodeTypeDeclarations,
    intrinsicNodeTypeSupportKey(nodeId, intrinsicNodeType),
    context.viable,
  );
}

function supertagApplicationKey(nodeId: string, supertagId: string): string {
  return JSON.stringify([nodeId, supertagId]);
}

function latestObservedCandidate(
  candidates: readonly ContributionFact[],
  observer: ContributionFact,
): ContributionFact | null {
  return (
    candidates
      .filter((candidate) => factObserves(observer, candidate))
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
