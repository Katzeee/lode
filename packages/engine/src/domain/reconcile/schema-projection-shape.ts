import { isNodeType, parseFieldTemplateConfig, parseFieldValueSeeds, type NodeType } from "../fact/index.js";
import { array, enumValue, exact, nonempty, object } from "../../shape-validation/index.js";
import type {
  EffectiveField,
  FieldConfigCandidate,
  MaterializedField,
  NodeStatus,
  ProjectionSectionValue,
  TemplateField,
} from "./projection-types.js";

type SchemaProjectionSection =
  | "schemaApplications"
  | "schemaFields"
  | "templateFields"
  | "schemaTemplateNodes"
  | "schemaExtensions"
  | "schemaSearchMembers"
  | "schemaExtensionConflicts"
  | "nodeStatuses"
  | "effectiveFields"
  | "materializedFields";

export function parseSchemaProjectionSectionValue(
  section: SchemaProjectionSection,
  value: unknown,
): ProjectionSectionValue<SchemaProjectionSection> {
  switch (section) {
    case "nodeStatuses":
      return parseNodeStatus(value);
    case "effectiveFields":
      return array(value, "Effective Fields", effectiveField);
    case "templateFields":
      return array(value, "Template Fields", templateField);
    case "materializedFields":
      return array(value, "Materialized Fields", materializedField);
    case "schemaApplications":
    case "schemaFields":
    case "schemaTemplateNodes":
    case "schemaExtensions":
    case "schemaSearchMembers":
    case "schemaExtensionConflicts":
      return identities(value);
  }
}

export function parseNodeStatus(value: unknown): NodeStatus {
  const item = object(value, "Node status");
  exact(item, ["nodeId", "nodeType", "state", "deletionFactIds"], "Node status");
  if (item.state !== "active" && item.state !== "deleted") {
    throw new Error("Node state is invalid");
  }
  return {
    nodeId: identity(item.nodeId),
    nodeType: parseNodeType(item.nodeType),
    state: item.state,
    deletionFactIds: identities(item.deletionFactIds),
  };
}

function parseNodeType(value: unknown): NodeType | null {
  if (value === null || isNodeType(value)) {
    return value;
  }
  throw new Error("Node types are invalid");
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
      "sourceSchemaIds",
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
    sourceSchemaIds: identities(item.sourceSchemaIds),
    sourceFieldNodeIds: identities(item.sourceFieldNodeIds),
    visibility: enumValue(item.visibility, ["pinned", "normal", "optional"] as const, "Field visibility"),
    configCandidates: array(item.configCandidates, "Field config candidates", fieldConfigCandidate),
    effectiveConfig: item.effectiveConfig === null ? null : parseFieldTemplateConfig(item.effectiveConfig),
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
  exact(candidate, ["initializationId", "schemaId", "source", "values"], "Field initialization candidate");
  if (candidate.source !== "static-default" && candidate.source !== "auto-initialize") {
    throw new Error("Field initialization source is invalid");
  }
  return {
    initializationId: identity(candidate.initializationId),
    schemaId: identity(candidate.schemaId),
    source: candidate.source,
    values: parseFieldValueSeeds(candidate.values),
  };
}

function templateField(value: unknown): TemplateField {
  const item = object(value, "Template Field");
  exact(
    item,
    ["fieldNodeId", "fieldOccurrenceId", "schemaId", "fieldDefinitionId", "configCandidates", "effectiveConfig"],
    "Template Field",
  );
  return {
    fieldNodeId: identity(item.fieldNodeId),
    fieldOccurrenceId: identity(item.fieldOccurrenceId),
    schemaId: identity(item.schemaId),
    fieldDefinitionId: identity(item.fieldDefinitionId),
    configCandidates: array(item.configCandidates, "Field config candidates", fieldConfigCandidate),
    effectiveConfig: item.effectiveConfig === null ? null : parseFieldTemplateConfig(item.effectiveConfig),
  };
}

function fieldConfigCandidate(value: unknown): FieldConfigCandidate {
  const candidate = object(value, "Field config candidate");
  exact(candidate, ["config", "sourceSchemaIds", "sourceFieldNodeIds", "contributionIds"], "Field config candidate");
  return {
    config: parseFieldTemplateConfig(candidate.config),
    sourceSchemaIds: identities(candidate.sourceSchemaIds),
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
