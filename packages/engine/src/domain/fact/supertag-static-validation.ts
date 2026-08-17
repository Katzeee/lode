import type { Mutation, SequenceAnchor } from "./types.js";
import type { SupertagMutation } from "./mutation-family.js";

export function validateSupertagMutation(mutation: SupertagMutation, factIdentity: string): void {
  requireIdentity(mutation.supertagId, "Supertag", factIdentity);
  if (
    mutation.kind === "supertag-template-field-discoverability-set" ||
    mutation.kind === "supertag-template-field-visibility-configure"
  ) {
    validateTemplateFieldConfiguration(mutation, factIdentity);
    return;
  }
  if (
    mutation.kind === "supertag-template-field-attach" ||
    mutation.kind === "supertag-template-field-existing-attach" ||
    mutation.kind === "supertag-template-field-detach"
  ) {
    for (const [identity, label] of [
      [mutation.templateFieldNodeId, "Template Field Node"],
      [mutation.templateFieldOccurrenceId, "Template Field Occurrence"],
      [mutation.fieldDefinitionId, "Field Definition"],
      [mutation.definitionOccurrenceId, "Template Field Definition endpoint Occurrence"],
      [mutation.staticDefaultValueNodeId, "Static Default value Node"],
      [mutation.staticDefaultValueOccurrenceId, "Static Default value Occurrence"],
    ] as const) {
      requireIdentity(identity, label, factIdentity);
    }
    const anchor =
      mutation.kind === "supertag-template-field-attach" || mutation.kind === "supertag-template-field-existing-attach"
        ? mutation.anchor
        : mutation.previousAnchor;
    if (anchor === undefined) {
      throw new Error(`Template Field detachment lacks semantic evidence: ${factIdentity}`);
    }
    validateNodeAnchor(anchor, factIdentity);
    return;
  }
  if (
    mutation.kind === "supertag-optional-field-contribution-attach" ||
    mutation.kind === "supertag-optional-field-contribution-detach"
  ) {
    for (const [identity, label] of [
      [mutation.fieldNurseryNodeId, "Field Nursery Node"],
      [mutation.fieldNurseryOccurrenceId, "Field Nursery Occurrence"],
      [mutation.nurseryDefinitionOccurrenceId, "Field Nursery Definition endpoint Occurrence"],
      [mutation.nurseryValueNodeId, "Field Nursery value Node"],
      [mutation.nurseryValueOccurrenceId, "Field Nursery value Occurrence"],
      [mutation.contributionNodeId, "Optional Field Contribution Node"],
      [mutation.contributionOccurrenceId, "Optional Field Contribution Occurrence"],
      [mutation.fieldDefinitionId, "Field Definition"],
      [mutation.definitionOccurrenceId, "Optional Field Definition endpoint Occurrence"],
      [mutation.valueNodeId, "Optional Field value Node"],
      [mutation.valueOccurrenceId, "Optional Field value Occurrence"],
    ] as const) {
      requireIdentity(identity, label, factIdentity);
    }
    const anchor =
      mutation.kind === "supertag-optional-field-contribution-attach" ? mutation.anchor : mutation.previousAnchor;
    if (anchor === undefined) {
      throw new Error(`Optional Field Contribution detachment lacks semantic evidence: ${factIdentity}`);
    }
    validateNodeAnchor(anchor, factIdentity);
    return;
  }
  if (mutation.kind === "supertag-template-node-add" || mutation.kind === "supertag-template-node-remove") {
    requireIdentity(mutation.templateNodeId, "Template Node", factIdentity);
    requireIdentity(mutation.templateOccurrenceId, "Template Node Occurrence", factIdentity);
    const anchor = mutation.kind === "supertag-template-node-add" ? mutation.anchor : mutation.previousAnchor;
    if (anchor === undefined) {
      throw new Error(`Template Node removal lacks semantic evidence: ${factIdentity}`);
    }
    validateNodeAnchor(anchor, factIdentity);
    return;
  }
  if (mutation.kind === "supertag-extension-add" || mutation.kind === "supertag-extension-remove") {
    validateExtension(mutation, factIdentity);
    return;
  }
  if (mutation.kind === "supertag-apply" || mutation.kind === "supertag-remove") {
    requireIdentity(mutation.hostNodeId, "Supertag Application host Node", factIdentity);
    requireIdentity(mutation.applicationNodeId, "Supertag Application relation Node", factIdentity);
    requireIdentity(mutation.applicationOccurrenceId, "Supertag Application relation Occurrence", factIdentity);
    requireIdentity(
      mutation.relationDefinitionOccurrenceId,
      "Node supertags relation Definition endpoint Occurrence",
      factIdentity,
    );
    requireIdentity(mutation.definitionOccurrenceId, "Supertag Definition endpoint Occurrence", factIdentity);
    if (mutation.kind === "supertag-remove") {
      requireIdentity(mutation.detachedValueNodeId, "detached Supertag value Node", factIdentity);
      requireIdentity(mutation.detachedValueOccurrenceId, "detached Supertag value Occurrence", factIdentity);
    }
  }
  const anchor = mutation.kind === "supertag-apply" ? mutation.anchor : mutation.previousAnchor;
  if (anchor === undefined) {
    throw new Error(`Supertag relation removal lacks semantic evidence: ${factIdentity}`);
  }
  validateNodeAnchor(anchor, factIdentity);
}

function validateTemplateFieldConfiguration(
  mutation: Extract<
    SupertagMutation,
    { kind: "supertag-template-field-discoverability-set" | "supertag-template-field-visibility-configure" }
  >,
  factIdentity: string,
): void {
  requireIdentity(mutation.templateFieldNodeId, "Template Field Node", factIdentity);
  requireIdentity(mutation.fieldDefinitionId, "Field Definition", factIdentity);
  if (mutation.kind === "supertag-template-field-discoverability-set") {
    if (mutation.previousDiscoverable === undefined) {
      throw new Error(`Template Field discoverability lacks semantic evidence: ${factIdentity}`);
    }
    return;
  }
  if (mutation.previousVisibility === undefined || mutation.observedVisibilityFactIds === undefined) {
    throw new Error(`Template Field visibility lacks semantic evidence: ${factIdentity}`);
  }
  if (new Set(mutation.observedVisibilityFactIds).size !== mutation.observedVisibilityFactIds.length) {
    throw new Error(`Template Field visibility repeats observed evidence: ${factIdentity}`);
  }
  mutation.observedVisibilityFactIds.forEach((id) =>
    requireIdentity(id, "observed Template Field visibility Fact", factIdentity),
  );
}

function validateExtension(
  mutation: Extract<Mutation, { kind: "supertag-extension-add" | "supertag-extension-remove" }>,
  factIdentity: string,
): void {
  requireIdentity(mutation.baseSupertagId, "Base Supertag", factIdentity);
  if (mutation.baseSupertagId === mutation.supertagId) {
    throw new Error(`Supertag cannot extend itself: ${factIdentity}`);
  }
  const anchor = mutation.kind === "supertag-extension-add" ? mutation.anchor : mutation.previousAnchor;
  if (anchor === undefined) {
    throw new Error(`Supertag Extension removal lacks semantic evidence: ${factIdentity}`);
  }
  validateNodeAnchor(anchor, factIdentity);
}

function validateNodeAnchor(anchor: SequenceAnchor, factIdentity: string): void {
  if (anchor.after !== null && anchor.before !== null && anchor.after === anchor.before) {
    throw new Error(`Sequence anchor repeats one identity: ${factIdentity}`);
  }
  for (const endpoint of [anchor.after, anchor.before]) {
    if (endpoint !== null) {
      requireIdentity(endpoint, "Field anchor endpoint", factIdentity);
    }
  }
}

function requireIdentity(value: string, label: string, factIdentity: string): void {
  if (value.length === 0) {
    throw new Error(`${label} identity is empty: ${factIdentity}`);
  }
}
