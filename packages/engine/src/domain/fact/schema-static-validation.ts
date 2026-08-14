import { isWellFormedUnicode } from "./text-validation.js";
import {
  initializedFieldNodeId,
  initializedFieldOccurrenceId,
  initializedValueNodeId,
  initializedValueOccurrenceId,
} from "./identity.js";
import type { Mutation, SequenceAnchor } from "./types.js";
import type { SchemaMutation } from "./mutation-family.js";
import type { FieldValueSeed } from "./field-template-types.js";

export function validateSchemaMutation(mutation: SchemaMutation, factIdentity: string): void {
  requireIdentity(mutation.schemaId, "Schema", factIdentity);
  if (
    mutation.kind === "schema-template-node-add" ||
    mutation.kind === "schema-template-node-remove"
  ) {
    requireIdentity(mutation.templateNodeId, "Template Node", factIdentity);
    requireIdentity(mutation.templateOccurrenceId, "Template Node Occurrence", factIdentity);
    const anchor =
      mutation.kind === "schema-template-node-add" ? mutation.anchor : mutation.previousAnchor;
    if (anchor === undefined) {
      throw new Error(`Template Node removal lacks semantic evidence: ${factIdentity}`);
    }
    validateNodeAnchor(anchor, factIdentity);
    return;
  }
  if (mutation.kind === "schema-field-configure") {
    validateFieldConfiguration(mutation, factIdentity);
    return;
  }
  if (mutation.kind === "schema-extension-add" || mutation.kind === "schema-extension-remove") {
    validateExtension(mutation, factIdentity);
    return;
  }
  if (mutation.kind === "schema-apply" || mutation.kind === "schema-remove") {
    requireIdentity(mutation.nodeId, "Schema application Node", factIdentity);
  } else {
    requireIdentity(mutation.fieldDefinitionId, "Field Definition", factIdentity);
  }
  if (mutation.kind === "schema-field-add" || mutation.kind === "schema-field-remove") {
    requireIdentity(mutation.fieldNodeId, "Template Field Node", factIdentity);
    requireIdentity(mutation.fieldOccurrenceId, "Template Field Occurrence", factIdentity);
    const anchor = mutation.kind === "schema-field-add" ? mutation.anchor : mutation.previousAnchor;
    if (anchor === undefined) {
      throw new Error(`Template Field removal lacks semantic evidence: ${factIdentity}`);
    }
    validateNodeAnchor(anchor, factIdentity);
    return;
  }
  const anchor = mutation.kind === "schema-apply" ? mutation.anchor : mutation.previousAnchor;
  if (anchor === undefined) {
    throw new Error(`Schema relation removal lacks semantic evidence: ${factIdentity}`);
  }
  validateNodeAnchor(anchor, factIdentity);
}

export function validateFieldInitialization(
  mutation: Extract<Mutation, { kind: "field-initialize" }>,
  factIdentity: string,
): void {
  requireIdentity(mutation.ownerNodeId, "Field owner Node", factIdentity);
  requireIdentity(mutation.schemaId, "Schema", factIdentity);
  requireIdentity(mutation.fieldDefinitionId, "Field Definition", factIdentity);
  requireIdentity(mutation.fieldNodeId, "Initialized Field Node", factIdentity);
  requireIdentity(mutation.fieldOccurrenceId, "Initialized Field Occurrence", factIdentity);
  if (
    mutation.fieldNodeId !==
      initializedFieldNodeId(mutation.ownerNodeId, mutation.fieldDefinitionId) ||
    mutation.fieldOccurrenceId !==
      initializedFieldOccurrenceId(mutation.ownerNodeId, mutation.fieldDefinitionId)
  ) {
    throw new Error(`Field initialization identity is not canonical: ${factIdentity}`);
  }
  if (mutation.observedInitializationFactIds === undefined) {
    throw new Error(`Field initialization lacks semantic evidence: ${factIdentity}`);
  }
  if (
    new Set(mutation.observedInitializationFactIds).size !==
    mutation.observedInitializationFactIds.length
  ) {
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
      value.kind === "reference"
        ? value.nodeId
        : initializedValueNodeId(mutation.fieldNodeId, index);
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
  mutation: Extract<Mutation, { kind: "schema-field-configure" }>,
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
  validateFieldTemplateConfig(mutation.config, factIdentity);
  if (mutation.previousConfig !== null) {
    validateFieldTemplateConfig(mutation.previousConfig, factIdentity);
  }
}

function validateExtension(
  mutation: Extract<Mutation, { kind: "schema-extension-add" | "schema-extension-remove" }>,
  factIdentity: string,
): void {
  requireIdentity(mutation.baseSchemaId, "Base Schema", factIdentity);
  if (mutation.baseSchemaId === mutation.schemaId) {
    throw new Error(`Schema cannot extend itself: ${factIdentity}`);
  }
  const anchor =
    mutation.kind === "schema-extension-add" ? mutation.anchor : mutation.previousAnchor;
  if (anchor === undefined) {
    throw new Error(`Schema Extension removal lacks semantic evidence: ${factIdentity}`);
  }
  validateNodeAnchor(anchor, factIdentity);
}

function validateFieldTemplateConfig(
  config: Extract<Mutation, { kind: "schema-field-configure" }>["config"],
  factIdentity: string,
): void {
  if (config.staticDefault !== null && config.initializer !== null) {
    throw new Error(`Field config cannot combine a default and initializer: ${factIdentity}`);
  }
  validateFieldSeeds(
    [
      ...(config.staticDefault ?? []),
      ...(config.initializer?.kind === "literal" ? config.initializer.values : []),
    ],
    factIdentity,
  );
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
