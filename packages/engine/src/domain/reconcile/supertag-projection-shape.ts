import { parseSupertagFieldConfig, parseFieldValueSeeds } from "../fact/index.js";
import { array, enumValue, exact, nonempty, object } from "../../shape-validation/index.js";
import type {
  EffectiveField,
  FieldConfigCandidate,
  MaterializedField,
  ProjectionSectionValue,
  TemplateField,
} from "./projection-types.js";

type SupertagProjectionSection =
  | "supertagApplications"
  | "supertagFields"
  | "templateFields"
  | "supertagTemplateNodes"
  | "supertagExtensions"
  | "supertagInstanceSupertags"
  | "supertagExtensionConflicts"
  | "effectiveFields"
  | "materializedFields";

export function parseSupertagProjectionSectionValue(
  section: SupertagProjectionSection,
  value: unknown,
): ProjectionSectionValue<SupertagProjectionSection> {
  switch (section) {
    case "effectiveFields":
      return array(value, "Effective Fields", effectiveField);
    case "templateFields":
      return array(value, "Template Fields", templateField);
    case "materializedFields":
      return array(value, "Materialized Fields", materializedField);
    case "supertagApplications":
    case "supertagFields":
    case "supertagTemplateNodes":
    case "supertagExtensions":
    case "supertagInstanceSupertags":
    case "supertagExtensionConflicts":
      return identities(value);
  }
}

function materializedField(value: unknown): MaterializedField {
  const item = object(value, "Materialized Field");
  exact(
    item,
    ["ownerNodeId", "fieldDefinitionId", "fieldNodeId", "fieldOccurrenceId", "valueOccurrenceIds"],
    "Materialized Field",
  );
  return {
    ownerNodeId: identity(item.ownerNodeId),
    fieldDefinitionId: identity(item.fieldDefinitionId),
    fieldNodeId: identity(item.fieldNodeId),
    fieldOccurrenceId: identity(item.fieldOccurrenceId),
    valueOccurrenceIds: identities(item.valueOccurrenceIds),
  };
}

function effectiveField(value: unknown): EffectiveField {
  const item = object(value, "Effective Field");
  exact(
    item,
    [
      "fieldDefinitionId",
      "sourceSupertagIds",
      "sourceFieldNodeIds",
      "visibility",
      "configCandidates",
      "effectiveConfig",
      "initializationCandidates",
      "initializedValues",
      "materializedFieldNodeId",
    ],
    "Effective Field",
  );
  return {
    fieldDefinitionId: identity(item.fieldDefinitionId),
    sourceSupertagIds: identities(item.sourceSupertagIds),
    sourceFieldNodeIds: identities(item.sourceFieldNodeIds),
    visibility: enumValue(item.visibility, ["pinned", "normal", "optional"] as const, "Field visibility"),
    configCandidates: array(item.configCandidates, "Field config candidates", fieldConfigCandidate),
    effectiveConfig: item.effectiveConfig === null ? null : parseSupertagFieldConfig(item.effectiveConfig),
    initializationCandidates: array(
      item.initializationCandidates,
      "Field initialization candidates",
      fieldInitializationCandidate,
    ),
    initializedValues: item.initializedValues === null ? null : parseFieldValueSeeds(item.initializedValues),
    materializedFieldNodeId: item.materializedFieldNodeId === null ? null : identity(item.materializedFieldNodeId),
  };
}

function fieldInitializationCandidate(value: unknown): EffectiveField["initializationCandidates"][number] {
  const candidate = object(value, "Field initialization candidate");
  exact(candidate, ["initializationId", "supertagId", "source", "values"], "Field initialization candidate");
  if (candidate.source !== "static-default" && candidate.source !== "auto-initialize") {
    throw new Error("Field initialization source is invalid");
  }
  return {
    initializationId: identity(candidate.initializationId),
    supertagId: identity(candidate.supertagId),
    source: candidate.source,
    values: parseFieldValueSeeds(candidate.values),
  };
}

function templateField(value: unknown): TemplateField {
  const item = object(value, "Template Field");
  exact(
    item,
    ["fieldNodeId", "fieldOccurrenceId", "supertagId", "fieldDefinitionId", "configCandidates", "effectiveConfig"],
    "Template Field",
  );
  return {
    fieldNodeId: identity(item.fieldNodeId),
    fieldOccurrenceId: identity(item.fieldOccurrenceId),
    supertagId: identity(item.supertagId),
    fieldDefinitionId: identity(item.fieldDefinitionId),
    configCandidates: array(item.configCandidates, "Field config candidates", fieldConfigCandidate),
    effectiveConfig: item.effectiveConfig === null ? null : parseSupertagFieldConfig(item.effectiveConfig),
  };
}

function fieldConfigCandidate(value: unknown): FieldConfigCandidate {
  const candidate = object(value, "Field config candidate");
  exact(candidate, ["config", "sourceSupertagIds", "sourceFieldNodeIds", "contributionIds"], "Field config candidate");
  return {
    config: parseSupertagFieldConfig(candidate.config),
    sourceSupertagIds: identities(candidate.sourceSupertagIds),
    sourceFieldNodeIds: identities(candidate.sourceFieldNodeIds),
    contributionIds: identities(candidate.contributionIds),
  };
}

function identities(value: unknown): string[] {
  return array(value, "Identities", identity);
}

function identity(value: unknown): string {
  return nonempty(value, "Identity");
}
