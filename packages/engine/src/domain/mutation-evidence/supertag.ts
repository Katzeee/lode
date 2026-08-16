import {
  FIELD_DEFINITION_NODE_TYPE,
  SUPERTAG_DEFINITION_NODE_TYPE,
  type DefinitionNodeType,
  type Mutation,
  type SupertagMutation,
  type SequenceAnchor,
} from "../fact/index.js";
import {
  definitionNodeState,
  isPresentNodeOutsideTrash,
  sequenceAnchorAt,
  type ScopedProjection,
} from "../reconcile/index.js";

export function completeSupertagMutationEvidence(
  mutation: SupertagMutation,
  previous: ScopedProjection,
  available: ScopedProjection,
): SupertagMutation {
  if (mutation.kind === "supertag-field-configure") {
    return completeSupertagFieldConfigurationEvidence(mutation, available);
  }
  if (mutation.kind === "supertag-apply" || mutation.kind === "supertag-remove") {
    return completeApplication(mutation, previous, available);
  }
  if (mutation.kind === "supertag-extension-add" || mutation.kind === "supertag-extension-remove") {
    return completeExtension(mutation, previous, available);
  }
  if (mutation.kind === "supertag-template-node-add" || mutation.kind === "supertag-template-node-remove") {
    return completeTemplateNodeRelation(mutation, previous, available);
  }
  return completeTemplateField(mutation, previous, available);
}

export function completeSupertagFieldConfigurationEvidence(
  mutation: Extract<Mutation, { kind: "supertag-field-configure" }>,
  available: ScopedProjection,
): Extract<Mutation, { kind: "supertag-field-configure" }> {
  assertDefinition(available, mutation.supertagId, "Supertag", SUPERTAG_DEFINITION_NODE_TYPE, false);
  assertDefinition(available, mutation.fieldDefinitionId, "Field", FIELD_DEFINITION_NODE_TYPE, false);
  assertNode(available, mutation.fieldNodeId, "Template Field");
  const field = available.templateFields[mutation.supertagId]?.find(
    (candidate) => candidate.fieldNodeId === mutation.fieldNodeId,
  );
  if (!field || field.fieldDefinitionId !== mutation.fieldDefinitionId) {
    throw new Error("Supertag Field is absent from the observed projection");
  }
  return {
    ...mutation,
    previousConfig: field.effectiveConfig,
    observedConfigFactIds: field.configCandidates.flatMap((candidate) => candidate.contributionIds),
  };
}

function completeApplication(
  mutation: Extract<Mutation, { kind: "supertag-apply" | "supertag-remove" }>,
  previous: ScopedProjection,
  available: ScopedProjection,
): Extract<Mutation, { kind: "supertag-apply" | "supertag-remove" }> {
  const removing = mutation.kind === "supertag-remove";
  assertDefinition(available, mutation.supertagId, "Supertag", SUPERTAG_DEFINITION_NODE_TYPE, removing);
  assertNode(available, mutation.nodeId, "Supertag application target");
  if (!removing) {
    assertRelationAnchor(
      available.supertagApplications[mutation.nodeId] ?? [],
      mutation.anchor,
      "Supertag Application",
    );
    return mutation;
  }
  return withPreviousAnchor(
    mutation,
    previous.supertagApplications[mutation.nodeId] ?? [],
    mutation.supertagId,
    "Supertag Application",
  );
}

function completeExtension(
  mutation: Extract<Mutation, { kind: "supertag-extension-add" | "supertag-extension-remove" }>,
  previous: ScopedProjection,
  available: ScopedProjection,
): Extract<Mutation, { kind: "supertag-extension-add" | "supertag-extension-remove" }> {
  const removing = mutation.kind === "supertag-extension-remove";
  assertDefinition(available, mutation.supertagId, "Supertag", SUPERTAG_DEFINITION_NODE_TYPE, removing);
  assertDefinition(available, mutation.baseSupertagId, "Base Supertag", SUPERTAG_DEFINITION_NODE_TYPE, removing);
  if (!removing) {
    assertRelationAnchor(
      available.supertagExtensions[mutation.supertagId] ?? [],
      mutation.anchor,
      "Supertag Extension",
    );
    return mutation;
  }
  return withPreviousAnchor(
    mutation,
    previous.supertagExtensions[mutation.supertagId] ?? [],
    mutation.baseSupertagId,
    "Supertag Extension",
  );
}

function completeTemplateField(
  mutation: Extract<Mutation, { kind: "supertag-field-add" | "supertag-field-remove" }>,
  previous: ScopedProjection,
  available: ScopedProjection,
): Extract<Mutation, { kind: "supertag-field-add" | "supertag-field-remove" }> {
  const removing = mutation.kind === "supertag-field-remove";
  assertDefinition(available, mutation.supertagId, "Supertag", SUPERTAG_DEFINITION_NODE_TYPE, removing);
  assertDefinition(available, mutation.fieldDefinitionId, "Field", FIELD_DEFINITION_NODE_TYPE, removing);
  if (!removing) {
    assertTemplateFieldAddition(mutation, available);
    return mutation;
  }
  const field = previous.templateFields[mutation.supertagId]?.find(
    (candidate) => candidate.fieldNodeId === mutation.fieldNodeId,
  );
  if (
    field?.fieldDefinitionId !== mutation.fieldDefinitionId ||
    field.fieldOccurrenceId !== mutation.fieldOccurrenceId
  ) {
    throw new Error("Template Field binding is absent from the observed projection");
  }
  return withPreviousAnchor(
    mutation,
    previous.childOccurrences[mutation.supertagId] ?? [],
    mutation.fieldOccurrenceId,
    "Template Field Occurrence",
  );
}

function assertTemplateFieldAddition(
  mutation: Extract<Mutation, { kind: "supertag-field-add" }>,
  available: ScopedProjection,
): void {
  const existing = available.templateFields[mutation.supertagId]?.find(
    (field) => field.fieldNodeId === mutation.fieldNodeId,
  );
  const occurrence = available.occurrences[mutation.fieldOccurrenceId];
  const matchingCreation =
    available.nodes[mutation.fieldNodeId] !== undefined &&
    occurrence?.nodeId === mutation.fieldNodeId &&
    occurrence.parentNodeId === mutation.supertagId;
  if (
    (available.nodes[mutation.fieldNodeId] || available.occurrences[mutation.fieldOccurrenceId]) &&
    !matchingCreation &&
    (existing?.fieldDefinitionId !== mutation.fieldDefinitionId ||
      existing.fieldOccurrenceId !== mutation.fieldOccurrenceId)
  ) {
    throw new Error("Template Field Node or Occurrence identity already exists");
  }
  if (
    (available.templateFields[mutation.supertagId] ?? []).some(
      (field) => field.fieldNodeId !== mutation.fieldNodeId && field.fieldDefinitionId === mutation.fieldDefinitionId,
    )
  ) {
    throw new Error("Supertag already contains the Template Field or Field Definition");
  }
  assertRelationAnchor(
    available.childOccurrences[mutation.supertagId] ?? [],
    mutation.anchor,
    "Template Field Occurrence",
  );
}

function completeTemplateNodeRelation(
  mutation: Extract<Mutation, { kind: "supertag-template-node-add" | "supertag-template-node-remove" }>,
  previous: ScopedProjection,
  available: ScopedProjection,
): Extract<Mutation, { kind: "supertag-template-node-add" | "supertag-template-node-remove" }> {
  const removing = mutation.kind === "supertag-template-node-remove";
  assertDefinition(available, mutation.supertagId, "Supertag", SUPERTAG_DEFINITION_NODE_TYPE, removing);
  if (!removing) {
    assertTemplateNodeAddition(mutation, available);
    return mutation;
  }
  const occurrence = previous.occurrences[mutation.templateOccurrenceId];
  if (occurrence?.nodeId !== mutation.templateNodeId || occurrence.parentNodeId !== mutation.supertagId) {
    throw new Error("Supertag Template Node Occurrence is absent from the observed projection");
  }
  return withPreviousAnchor(
    mutation,
    previous.childOccurrences[mutation.supertagId] ?? [],
    mutation.templateOccurrenceId,
    "Supertag Template Node Occurrence",
  );
}

function assertTemplateNodeAddition(
  mutation: Extract<Mutation, { kind: "supertag-template-node-add" }>,
  available: ScopedProjection,
): void {
  assertNode(available, mutation.templateNodeId, "Template");
  const occurrence = available.occurrences[mutation.templateOccurrenceId];
  if (
    occurrence &&
    (occurrence.nodeId !== mutation.templateNodeId || occurrence.parentNodeId !== mutation.supertagId)
  ) {
    throw new Error("Template Node Occurrence identity already exists");
  }
  const existing = templateOccurrenceFor(available, mutation.supertagId, mutation.templateNodeId);
  if (existing && existing !== mutation.templateOccurrenceId) {
    throw new Error("Supertag already contains the Template Node");
  }
  assertRelationAnchor(
    available.childOccurrences[mutation.supertagId] ?? [],
    mutation.anchor,
    "Supertag Template Node Occurrence",
  );
}

function withPreviousAnchor<MutationType extends SupertagMutation>(
  mutation: MutationType,
  identities: readonly string[],
  identity: string,
  label: string,
): MutationType {
  const index = identities.indexOf(identity);
  if (index < 0) {
    throw new Error(`${label} is absent from the observed projection`);
  }
  return { ...mutation, previousAnchor: sequenceAnchorAt(identities, index) };
}

function assertRelationAnchor(identities: readonly string[], anchor: SequenceAnchor, label: string): void {
  if ([anchor.after, anchor.before].some((id) => id !== null && !identities.includes(id))) {
    throw new Error(`${label} anchor is absent from the observed projection`);
  }
}

function assertDefinition(
  projection: ScopedProjection,
  definitionId: string,
  label: string,
  nodeType: DefinitionNodeType,
  allowDeleted: boolean,
): void {
  const state = definitionNodeState(projection, definitionId, nodeType);
  if (state === "active" || (allowDeleted && state === "deleted")) {
    return;
  }
  throw new Error(`${label} type is absent from the observed projection`);
}

function assertNode(projection: ScopedProjection, nodeId: string, label: string): void {
  if (!isPresentNodeOutsideTrash(projection.identity.workspaceNodeId, projection, nodeId)) {
    throw new Error(`${label} Node is absent from the observed projection`);
  }
}

function templateOccurrenceFor(
  projection: Pick<ScopedProjection, "occurrences">,
  supertagId: string,
  templateNodeId: string,
): string | null {
  return (
    Object.values(projection.occurrences)
      .filter((occurrence) => occurrence.parentNodeId === supertagId && occurrence.nodeId === templateNodeId)
      .map((occurrence) => occurrence.occurrenceId)
      .sort()[0] ?? null
  );
}
