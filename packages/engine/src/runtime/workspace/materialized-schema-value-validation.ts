import type { ProjectionSection } from "./materialized-generation-format.js";

export function isSchemaSectionValue(section: ProjectionSection, value: unknown): boolean | null {
  if (section === "templateFields") {
    return Array.isArray(value) && value.every(isTemplateField);
  }
  if (section === "effectiveFields") {
    return Array.isArray(value) && value.every(isEffectiveField);
  }
  return null;
}

function isTemplateField(item: unknown): boolean {
  return (
    hasExactKeys(item, [
      "fieldNodeId",
      "fieldOccurrenceId",
      "schemaId",
      "fieldDefinitionId",
      "configCandidates",
      "effectiveConfig",
    ]) &&
    typeof item.fieldNodeId === "string" &&
    typeof item.fieldOccurrenceId === "string" &&
    typeof item.schemaId === "string" &&
    typeof item.fieldDefinitionId === "string" &&
    Array.isArray(item.configCandidates) &&
    item.configCandidates.every(isFieldConfigCandidate) &&
    (item.effectiveConfig === null || isFieldTemplateConfig(item.effectiveConfig))
  );
}

function isEffectiveField(field: unknown): boolean {
  return (
    hasExactKeys(field, [
      "fieldDefinitionId",
      "sourceSchemaIds",
      "sourceFieldNodeIds",
      "visibility",
      "configCandidates",
      "effectiveConfig",
      "initializationCandidates",
      "initializedValues",
      "materializedFieldNodeId",
    ]) &&
    typeof field.fieldDefinitionId === "string" &&
    strings(field.sourceSchemaIds) &&
    strings(field.sourceFieldNodeIds) &&
    ["pinned", "normal", "optional"].includes(field.visibility as string) &&
    Array.isArray(field.configCandidates) &&
    field.configCandidates.every(isFieldConfigCandidate) &&
    (field.effectiveConfig === null || isFieldTemplateConfig(field.effectiveConfig)) &&
    Array.isArray(field.initializationCandidates) &&
    field.initializationCandidates.every(isInitializationCandidate) &&
    (field.initializedValues === null || isFieldSeeds(field.initializedValues)) &&
    isNullableString(field.materializedFieldNodeId)
  );
}

function isInitializationCandidate(candidate: unknown): boolean {
  return (
    hasExactKeys(candidate, ["initializationId", "schemaId", "source", "values"]) &&
    typeof candidate.initializationId === "string" &&
    typeof candidate.schemaId === "string" &&
    ["static-default", "auto-initialize"].includes(candidate.source as string) &&
    isFieldSeeds(candidate.values)
  );
}

function isFieldConfigCandidate(value: unknown): boolean {
  return (
    hasExactKeys(value, ["config", "sourceSchemaIds", "sourceFieldNodeIds", "contributionIds"]) &&
    isFieldTemplateConfig(value.config) &&
    strings(value.sourceSchemaIds) &&
    strings(value.sourceFieldNodeIds) &&
    strings(value.contributionIds)
  );
}

function isFieldTemplateConfig(value: unknown): boolean {
  return (
    hasExactKeys(value, ["visibility", "staticDefault", "initializer"]) &&
    ["pinned", "normal", "optional"].includes(value.visibility as string) &&
    (value.staticDefault === null || isFieldSeeds(value.staticDefault)) &&
    (value.initializer === null || isFieldInitializer(value.initializer))
  );
}

function isFieldInitializer(value: unknown): boolean {
  return (
    (hasExactKeys(value, ["kind"]) && value.kind === "application-node-text") ||
    (hasExactKeys(value, ["kind", "values"]) &&
      value.kind === "literal" &&
      isFieldSeeds(value.values))
  );
}

function isFieldSeeds(value: unknown): boolean {
  return Array.isArray(value) && value.every(isFieldSeed);
}

function isFieldSeed(seed: unknown): boolean {
  return (
    (hasExactKeys(seed, ["kind", "value"]) &&
      seed.kind === "text" &&
      typeof seed.value === "string") ||
    (hasExactKeys(seed, ["kind", "nodeId"]) &&
      seed.kind === "reference" &&
      typeof seed.nodeId === "string")
  );
}

function strings(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}
