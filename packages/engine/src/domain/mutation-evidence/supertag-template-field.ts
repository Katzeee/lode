import { SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE, type SupertagMutation } from "../fact/index.js";
import { sequenceAnchorAt, type ScopedProjection } from "../reconcile/index.js";

type TemplateFieldMutation = Exclude<
  SupertagMutation,
  {
    kind:
      | "supertag-apply"
      | "supertag-remove"
      | "supertag-extension-add"
      | "supertag-extension-remove"
      | "supertag-template-node-add"
      | "supertag-template-node-remove";
  }
>;

export function completeTemplateFieldEvidence(
  mutation: TemplateFieldMutation,
  previous: ScopedProjection,
  available: ScopedProjection,
): TemplateFieldMutation {
  if (
    mutation.kind === "supertag-template-field-attach" ||
    mutation.kind === "supertag-template-field-existing-attach"
  ) {
    assertTemplateFieldAttachment(mutation, available);
    return mutation;
  }
  if (mutation.kind === "supertag-template-field-detach") {
    const field = (previous.templateFields[mutation.supertagId] ?? []).find(
      (candidate) => candidate.templateFieldNodeId === mutation.templateFieldNodeId,
    );
    if (
      field?.fieldDefinitionId !== mutation.fieldDefinitionId ||
      field.templateFieldOccurrenceId !== mutation.templateFieldOccurrenceId ||
      field.definitionOccurrenceId !== mutation.definitionOccurrenceId ||
      field.staticDefaultValueNodeId !== mutation.staticDefaultValueNodeId ||
      field.staticDefaultValueOccurrenceId !== mutation.staticDefaultValueOccurrenceId
    ) {
      throw new Error("Template Field relation is absent from the observed projection");
    }
    return withPreviousAnchor(
      mutation,
      previous.childOccurrences[mutation.supertagId] ?? [],
      mutation.templateFieldOccurrenceId,
      "Template Field Occurrence",
    );
  }
  if (mutation.kind === "supertag-template-field-discoverability-set") {
    const field = (previous.templateFields[mutation.supertagId] ?? []).find(
      (candidate) =>
        candidate.templateFieldNodeId === mutation.templateFieldNodeId &&
        candidate.fieldDefinitionId === mutation.fieldDefinitionId,
    );
    if (field === undefined) {
      throw new Error("Template Field is absent from the observed projection");
    }
    return { ...mutation, previousDiscoverable: field.fieldDefinitionOwner === "workspace-schema" };
  }
  if (mutation.kind === "supertag-template-field-visibility-configure") {
    const field = (previous.templateFields[mutation.supertagId] ?? []).find(
      (candidate) =>
        candidate.templateFieldNodeId === mutation.templateFieldNodeId &&
        candidate.fieldDefinitionId === mutation.fieldDefinitionId,
    );
    if (field === undefined) {
      throw new Error("Template Field is absent from the observed projection");
    }
    return {
      ...mutation,
      previousVisibility: field.visibility,
      observedVisibilityFactIds: field.visibilityCandidates.map((candidate) => candidate.contributionId),
    };
  }
  if (mutation.kind === "supertag-optional-field-contribution-attach") {
    assertOptionalFieldAttachment(mutation, available);
    return mutation;
  }
  const contribution = (previous.optionalFieldContributions[mutation.supertagId] ?? []).find(
    (candidate) => candidate.contributionNodeId === mutation.contributionNodeId,
  );
  if (
    contribution?.fieldNurseryNodeId !== mutation.fieldNurseryNodeId ||
    contribution.fieldDefinitionId !== mutation.fieldDefinitionId
  ) {
    throw new Error("Optional Field Contribution is absent from the observed projection");
  }
  return withPreviousAnchor(
    mutation,
    previous.childOccurrences[mutation.nurseryValueNodeId] ?? [],
    mutation.contributionOccurrenceId,
    "Optional Field Contribution Occurrence",
  );
}

function assertTemplateFieldAttachment(
  mutation: Extract<
    TemplateFieldMutation,
    { kind: "supertag-template-field-attach" | "supertag-template-field-existing-attach" }
  >,
  available: ScopedProjection,
): void {
  const placement = available.occurrences[mutation.templateFieldOccurrenceId];
  const definition = available.occurrences[mutation.definitionOccurrenceId];
  const defaultValue = available.occurrences[mutation.staticDefaultValueOccurrenceId];
  const commonShape =
    available.nodes[mutation.supertagId]?.intrinsicNodeType === SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE &&
    available.nodes[mutation.templateFieldNodeId]?.intrinsicNodeType === "field" &&
    available.nodes[mutation.fieldDefinitionId]?.intrinsicNodeType === "field-definition" &&
    available.nodes[mutation.staticDefaultValueNodeId] !== undefined &&
    available.nodeOwners[mutation.staticDefaultValueNodeId] === mutation.templateFieldNodeId &&
    definition?.nodeId === mutation.fieldDefinitionId &&
    definition.parentNodeId === mutation.templateFieldNodeId &&
    defaultValue?.nodeId === mutation.staticDefaultValueNodeId &&
    defaultValue.parentNodeId === mutation.templateFieldNodeId;
  const activeShape =
    available.nodeOwners[mutation.templateFieldNodeId] === mutation.supertagId &&
    (available.nodeOwners[mutation.fieldDefinitionId] === mutation.templateFieldNodeId ||
      available.nodeOwners[mutation.fieldDefinitionId] === available.workspaceSystemNodes.schema) &&
    placement?.nodeId === mutation.templateFieldNodeId &&
    placement.parentNodeId === mutation.supertagId;
  const removedShape =
    available.workspaceSystemNodes.trash !== undefined &&
    available.nodeOwners[mutation.templateFieldNodeId] === available.workspaceSystemNodes.trash &&
    available.nodeOwners[mutation.fieldDefinitionId] === available.workspaceSystemNodes.schema &&
    placement?.nodeId === mutation.templateFieldNodeId &&
    placement.parentNodeId === available.workspaceSystemNodes.trash;
  const definitionOwnerMatchesSemantic =
    mutation.kind !== "supertag-template-field-existing-attach" ||
    available.nodeOwners[mutation.fieldDefinitionId] === available.workspaceSystemNodes.schema;
  if (!commonShape || !definitionOwnerMatchesSemantic || (!activeShape && !removedShape)) {
    throw new Error("Template Field relation structure is absent from the observed projection");
  }
  assertAnchor(available.childOccurrences[mutation.supertagId] ?? [], mutation.anchor, "Template Field");
}

function assertOptionalFieldAttachment(
  mutation: Extract<TemplateFieldMutation, { kind: "supertag-optional-field-contribution-attach" }>,
  available: ScopedProjection,
): void {
  const metanodeId = available.metanodes[mutation.supertagId];
  const nurseryPlacement = available.occurrences[mutation.fieldNurseryOccurrenceId];
  const contributionPlacement = available.occurrences[mutation.contributionOccurrenceId];
  const definition = available.occurrences[mutation.definitionOccurrenceId];
  const value = available.occurrences[mutation.valueOccurrenceId];
  if (
    metanodeId === undefined ||
    available.nodeOwners[mutation.fieldNurseryNodeId] !== metanodeId ||
    available.nodeOwners[mutation.contributionNodeId] !== mutation.nurseryValueNodeId ||
    available.nodeOwners[mutation.valueNodeId] !== mutation.contributionNodeId ||
    nurseryPlacement?.nodeId !== mutation.fieldNurseryNodeId ||
    nurseryPlacement.parentNodeId !== metanodeId ||
    contributionPlacement?.nodeId !== mutation.contributionNodeId ||
    contributionPlacement.parentNodeId !== mutation.nurseryValueNodeId ||
    definition?.nodeId !== mutation.fieldDefinitionId ||
    definition.parentNodeId !== mutation.contributionNodeId ||
    value?.nodeId !== mutation.valueNodeId ||
    value.parentNodeId !== mutation.contributionNodeId
  ) {
    throw new Error("Optional Field Contribution structure is absent from the observed projection");
  }
  assertAnchor(
    available.childOccurrences[mutation.nurseryValueNodeId] ?? [],
    mutation.anchor,
    "Optional Field Contribution",
  );
}

function withPreviousAnchor<T extends TemplateFieldMutation>(
  mutation: T,
  identities: readonly string[],
  identity: string,
  label: string,
): T {
  const index = identities.indexOf(identity);
  if (index < 0) {
    throw new Error(`${label} is absent from the observed projection`);
  }
  return { ...mutation, previousAnchor: sequenceAnchorAt(identities, index) };
}

function assertAnchor(
  identities: readonly string[],
  anchor: Extract<
    TemplateFieldMutation,
    { kind: "supertag-template-field-attach" | "supertag-template-field-existing-attach" }
  >["anchor"],
  label: string,
): void {
  if ([anchor.after, anchor.before].some((id) => id !== null && !identities.includes(id))) {
    throw new Error(`${label} anchor is absent from the observed projection`);
  }
}
