import type { FieldTemplateConfig, FieldValueSeed } from "../domain/fact/index.js";
import type {
  EffectiveField,
  NodeStatus,
  FieldConfigCandidate,
  MaterializedField,
  TemplateField,
} from "../domain/reconcile/index.js";
import type { ProjectionPageSection, ProjectionPageValue } from "./contract.js";

export type SchemaProjectionMaps = Readonly<{
  schemaApplications: Readonly<Record<string, readonly string[]>>;
  schemaFields: Readonly<Record<string, readonly string[]>>;
  templateFields: Readonly<Record<string, readonly TemplateField[]>>;
  schemaTemplateNodes: Readonly<Record<string, readonly string[]>>;
  schemaExtensions: Readonly<Record<string, readonly string[]>>;
  schemaSearchMembers: Readonly<Record<string, readonly string[]>>;
  schemaExtensionConflicts: Readonly<Record<string, readonly string[]>>;
  nodeStatuses: Readonly<Record<string, NodeStatus>>;
  effectiveFields: Readonly<Record<string, readonly EffectiveField[]>>;
  materializedFields: Readonly<Record<string, readonly MaterializedField[]>>;
}>;

export function parseSchemaProjectionMaps(
  section: ProjectionPageSection,
  value: Record<string, unknown>,
): SchemaProjectionMaps {
  return {
    schemaApplications: mapOrEmpty(section, "schemaApplications", value.schemaApplications, ids),
    schemaFields: mapOrEmpty(section, "schemaFields", value.schemaFields, ids),
    templateFields: mapOrEmpty(section, "templateFields", value.templateFields, (item) =>
      array(item, templateField),
    ),
    schemaTemplateNodes: mapOrEmpty(section, "schemaTemplateNodes", value.schemaTemplateNodes, ids),
    schemaExtensions: mapOrEmpty(section, "schemaExtensions", value.schemaExtensions, ids),
    schemaSearchMembers: mapOrEmpty(section, "schemaSearchMembers", value.schemaSearchMembers, ids),
    schemaExtensionConflicts: mapOrEmpty(
      section,
      "schemaExtensionConflicts",
      value.schemaExtensionConflicts,
      ids,
    ),
    nodeStatuses: mapOrEmpty(section, "nodeStatuses", value.nodeStatuses, nodeStatus),
    effectiveFields: mapOrEmpty(section, "effectiveFields", value.effectiveFields, (item) =>
      array(item, effectiveField),
    ),
    materializedFields: mapOrEmpty(
      section,
      "materializedFields",
      value.materializedFields,
      (item) => array(item, materializedField),
    ),
  };
}

export function parseSchemaProjectionValue(
  section:
    | "schemaApplications"
    | "schemaFields"
    | "templateFields"
    | "schemaTemplateNodes"
    | "schemaExtensions"
    | "schemaSearchMembers"
    | "schemaExtensionConflicts"
    | "nodeStatuses"
    | "effectiveFields"
    | "materializedFields",
  value: unknown,
): ProjectionPageValue {
  return section === "nodeStatuses"
    ? nodeStatus(value)
    : section === "effectiveFields"
      ? array(value, effectiveField)
      : section === "templateFields"
        ? array(value, templateField)
        : section === "materializedFields"
          ? array(value, materializedField)
          : ids(value);
}

function nodeStatus(value: unknown): NodeStatus {
  const item = record(value, "Node status");
  exact(item, ["nodeId", "roles", "state", "deletionFactIds"]);
  const roles = array(item.roles, (role) => {
    if (role !== "schema" && role !== "field") {
      throw new Error("Node role is invalid");
    }
    return role;
  });
  if (item.state !== "active" && item.state !== "deleted") {
    throw new Error("Node state is invalid");
  }
  return {
    nodeId: identity(item.nodeId),
    roles,
    state: item.state,
    deletionFactIds: ids(item.deletionFactIds),
  };
}

function materializedField(value: unknown): MaterializedField {
  const item = record(value, "Materialized Field");
  exact(item, [
    "ownerNodeId",
    "fieldDefinitionId",
    "fieldNodeId",
    "fieldOccurrenceId",
    "valueOccurrenceIds",
  ]);
  return {
    ownerNodeId: identity(item.ownerNodeId),
    fieldDefinitionId: identity(item.fieldDefinitionId),
    fieldNodeId: identity(item.fieldNodeId),
    fieldOccurrenceId: identity(item.fieldOccurrenceId),
    valueOccurrenceIds: ids(item.valueOccurrenceIds),
  };
}

function effectiveField(value: unknown): EffectiveField {
  const item = record(value, "Effective Field");
  exact(item, [
    "fieldDefinitionId",
    "sourceSchemaIds",
    "sourceFieldNodeIds",
    "visibility",
    "configCandidates",
    "effectiveConfig",
    "initializationCandidates",
    "initializedValues",
    "materializedFieldNodeId",
  ]);
  return {
    fieldDefinitionId: identity(item.fieldDefinitionId),
    sourceSchemaIds: ids(item.sourceSchemaIds),
    sourceFieldNodeIds: ids(item.sourceFieldNodeIds),
    visibility: visibility(item.visibility),
    configCandidates: array(item.configCandidates, fieldConfigCandidate),
    effectiveConfig:
      item.effectiveConfig === null ? null : parseFieldTemplateConfig(item.effectiveConfig),
    initializationCandidates: array(item.initializationCandidates, fieldInitializationCandidate),
    initializedValues:
      item.initializedValues === null ? null : array(item.initializedValues, fieldValueSeed),
    materializedFieldNodeId:
      item.materializedFieldNodeId === null ? null : identity(item.materializedFieldNodeId),
  };
}

function fieldInitializationCandidate(
  value: unknown,
): EffectiveField["initializationCandidates"][number] {
  const candidate = record(value, "Field initialization candidate");
  exact(candidate, ["initializationId", "schemaId", "source", "values"]);
  if (candidate.source !== "static-default" && candidate.source !== "auto-initialize") {
    throw new Error("Field initialization source is invalid");
  }
  return {
    initializationId: identity(candidate.initializationId),
    schemaId: identity(candidate.schemaId),
    source: candidate.source,
    values: array(candidate.values, fieldValueSeed),
  };
}

function templateField(value: unknown): TemplateField {
  const item = record(value, "Template Field");
  exact(item, [
    "fieldNodeId",
    "fieldOccurrenceId",
    "schemaId",
    "fieldDefinitionId",
    "configCandidates",
    "effectiveConfig",
  ]);
  return {
    fieldNodeId: identity(item.fieldNodeId),
    fieldOccurrenceId: identity(item.fieldOccurrenceId),
    schemaId: identity(item.schemaId),
    fieldDefinitionId: identity(item.fieldDefinitionId),
    configCandidates: array(item.configCandidates, fieldConfigCandidate),
    effectiveConfig:
      item.effectiveConfig === null ? null : parseFieldTemplateConfig(item.effectiveConfig),
  };
}

function fieldConfigCandidate(value: unknown): FieldConfigCandidate {
  const candidate = record(value, "Field config candidate");
  exact(candidate, ["config", "sourceSchemaIds", "sourceFieldNodeIds", "contributionIds"]);
  return {
    config: parseFieldTemplateConfig(candidate.config),
    sourceSchemaIds: ids(candidate.sourceSchemaIds),
    sourceFieldNodeIds: ids(candidate.sourceFieldNodeIds),
    contributionIds: ids(candidate.contributionIds),
  };
}

export function parseFieldTemplateConfig(value: unknown): FieldTemplateConfig {
  const config = record(value, "Field Template config");
  exact(config, ["visibility", "staticDefault", "initializer"]);
  return {
    visibility: visibility(config.visibility),
    staticDefault:
      config.staticDefault === null ? null : array(config.staticDefault, fieldValueSeed),
    initializer:
      config.initializer === null
        ? null
        : (() => {
            const initializer = record(config.initializer, "Field initializer");
            if (initializer.kind === "application-node-text") {
              exact(initializer, ["kind"]);
              return { kind: "application-node-text" as const };
            }
            exact(initializer, ["kind", "values"]);
            if (initializer.kind !== "literal") {
              throw new Error("Field initializer kind is invalid");
            }
            return { kind: "literal" as const, values: array(initializer.values, fieldValueSeed) };
          })(),
  };
}

function fieldValueSeed(value: unknown): FieldValueSeed {
  const seed = record(value, "Field value seed");
  if (seed.kind === "text") {
    exact(seed, ["kind", "value"]);
    if (typeof seed.value !== "string") {
      throw new Error("Field text seed is invalid");
    }
    return { kind: "text", value: seed.value };
  }
  exact(seed, ["kind", "nodeId"]);
  if (seed.kind !== "reference") {
    throw new Error("Field value seed kind is invalid");
  }
  return { kind: "reference", nodeId: identity(seed.nodeId) };
}

export function parseFieldValueSeeds(value: unknown): readonly FieldValueSeed[] {
  return array(value, fieldValueSeed);
}

function visibility(value: unknown): "pinned" | "normal" | "optional" {
  if (value !== "pinned" && value !== "normal" && value !== "optional") {
    throw new Error("Field visibility is invalid");
  }
  return value;
}

function mapOrEmpty<T>(
  actual: ProjectionPageSection,
  expected: ProjectionPageSection,
  value: unknown,
  parse: (item: unknown) => T,
): Record<string, T> {
  const source = record(value, expected);
  if (actual !== expected) {
    if (Object.keys(source).length > 0) {
      throw new Error(`${expected} must be empty`);
    }
    return {};
  }
  return Object.fromEntries(Object.entries(source).map(([key, item]) => [key, parse(item)]));
}

function ids(value: unknown): string[] {
  return array(value, identity);
}

function array<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) {
    throw new Error("Schema projection value must be an array");
  }
  return value.map(parse);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new Error("Effective Field has unknown or missing fields");
  }
}

function identity(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Identity is invalid");
  }
  return value;
}
