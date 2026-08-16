import { isWellFormedUnicode } from "./text-validation.js";
import {
  initializedFieldNodeId,
  initializedFieldOccurrenceId,
  initializedValueNodeId,
  initializedValueOccurrenceId,
} from "./identity.js";
import type { Mutation, SequenceAnchor } from "./types.js";
import type { SupertagMutation } from "./mutation-family.js";
import type { FieldValueSeed } from "./field-value-types.js";

export function validateSupertagMutation(mutation: SupertagMutation, factIdentity: string): void {
  requireIdentity(mutation.supertagId, "Supertag", factIdentity);
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
  if (mutation.kind === "supertag-field-configure") {
    validateFieldConfiguration(mutation, factIdentity);
    return;
  }
  if (mutation.kind === "supertag-extension-add" || mutation.kind === "supertag-extension-remove") {
    validateExtension(mutation, factIdentity);
    return;
  }
  if (mutation.kind === "supertag-apply" || mutation.kind === "supertag-remove") {
    requireIdentity(mutation.nodeId, "Supertag application Node", factIdentity);
  } else {
    requireIdentity(mutation.fieldDefinitionId, "Field Definition", factIdentity);
  }
  if (mutation.kind === "supertag-field-add" || mutation.kind === "supertag-field-remove") {
    requireIdentity(mutation.fieldNodeId, "Template Field Node", factIdentity);
    requireIdentity(mutation.fieldOccurrenceId, "Template Field Occurrence", factIdentity);
    const anchor = mutation.kind === "supertag-field-add" ? mutation.anchor : mutation.previousAnchor;
    if (anchor === undefined) {
      throw new Error(`Template Field removal lacks semantic evidence: ${factIdentity}`);
    }
    validateNodeAnchor(anchor, factIdentity);
    return;
  }
  const anchor = mutation.kind === "supertag-apply" ? mutation.anchor : mutation.previousAnchor;
  if (anchor === undefined) {
    throw new Error(`Supertag relation removal lacks semantic evidence: ${factIdentity}`);
  }
  validateNodeAnchor(anchor, factIdentity);
}

export function validateFieldInitialization(
  mutation: Extract<Mutation, { kind: "field-initialize" }>,
  factIdentity: string,
): void {
  requireIdentity(mutation.ownerNodeId, "Field owner Node", factIdentity);
  requireIdentity(mutation.supertagId, "Supertag", factIdentity);
  requireIdentity(mutation.fieldDefinitionId, "Field Definition", factIdentity);
  requireIdentity(mutation.fieldNodeId, "Initialized Field Node", factIdentity);
  requireIdentity(mutation.fieldOccurrenceId, "Initialized Field Occurrence", factIdentity);
  if (
    mutation.fieldNodeId !== initializedFieldNodeId(mutation.ownerNodeId, mutation.fieldDefinitionId) ||
    mutation.fieldOccurrenceId !== initializedFieldOccurrenceId(mutation.ownerNodeId, mutation.fieldDefinitionId)
  ) {
    throw new Error(`Field initialization identity is not canonical: ${factIdentity}`);
  }
  if (mutation.observedInitializationFactIds === undefined) {
    throw new Error(`Field initialization lacks semantic evidence: ${factIdentity}`);
  }
  if (new Set(mutation.observedInitializationFactIds).size !== mutation.observedInitializationFactIds.length) {
    throw new Error(`Field initialization evidence contains duplicate Facts: ${factIdentity}`);
  }
  validateInitializedFieldValues(mutation, factIdentity);
}

function validateInitializedFieldValues(
  mutation: Extract<Mutation, { kind: "field-initialize" }>,
  factIdentity: string,
): void {
  const identities = new Set<string>();
  mutation.values.forEach((value, index) => {
    requireIdentity(value.nodeId, "Initialized Field Value Node", factIdentity);
    requireIdentity(value.occurrenceId, "Initialized Field Value Occurrence", factIdentity);
    if (identities.has(value.occurrenceId)) {
      throw new Error(`Field initialization repeats a Value Occurrence: ${factIdentity}`);
    }
    const expectedNodeId =
      value.kind === "reference" ? value.nodeId : initializedValueNodeId(mutation.fieldNodeId, index);
    if (
      value.nodeId !== expectedNodeId ||
      value.occurrenceId !== initializedValueOccurrenceId(mutation.fieldOccurrenceId, index)
    ) {
      throw new Error(`Field initialization Value identity is not canonical: ${factIdentity}`);
    }
    identities.add(value.occurrenceId);
    if (value.kind === "text" && !isWellFormedUnicode(value.value)) {
      throw new Error(`Initialized Field Value contains an unpaired surrogate: ${factIdentity}`);
    }
  });
}

function validateFieldConfiguration(
  mutation: Extract<Mutation, { kind: "supertag-field-configure" }>,
  factIdentity: string,
): void {
  requireIdentity(mutation.fieldDefinitionId, "Field Definition", factIdentity);
  requireIdentity(mutation.fieldNodeId, "Template Field Node", factIdentity);
  if (mutation.observedConfigFactIds === undefined || mutation.previousConfig === undefined) {
    throw new Error(`Field config lacks semantic evidence: ${factIdentity}`);
  }
  if (new Set(mutation.observedConfigFactIds).size !== mutation.observedConfigFactIds.length) {
    throw new Error(`Field config evidence contains duplicate Facts: ${factIdentity}`);
  }
  mutation.observedConfigFactIds.forEach((identity) =>
    requireIdentity(identity, "observed Field config Fact", factIdentity),
  );
  validateSupertagFieldConfig(mutation.config, factIdentity);
  if (mutation.previousConfig !== null) {
    validateSupertagFieldConfig(mutation.previousConfig, factIdentity);
  }
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

function validateSupertagFieldConfig(
  config: Extract<Mutation, { kind: "supertag-field-configure" }>["config"],
  factIdentity: string,
): void {
  validateFieldSeeds(config.staticDefault ?? [], factIdentity);
}

function validateFieldSeeds(seeds: readonly FieldValueSeed[], factIdentity: string): void {
  for (const seed of seeds) {
    if (seed.kind === "reference") {
      requireIdentity(seed.nodeId, "Field seed Reference", factIdentity);
    } else if (!isWellFormedUnicode(seed.value)) {
      throw new Error(`Field seed contains an unpaired surrogate: ${factIdentity}`);
    }
  }
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
