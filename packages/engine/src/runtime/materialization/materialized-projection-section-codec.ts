import { isNodeType, type ProjectionIdentity, type ViewMode } from "../../domain/fact/index.js";
import {
  PROJECTION_SECTION_NAMES,
  type Projection,
  type ProjectionSectionName,
  type ProjectionSections,
} from "../../domain/reconcile/index.js";
import { isSchemaSectionValue } from "./materialized-schema-value-validation.js";
import { hasExactKeys, isRecord, isStringArray } from "./materialized-validation-primitives.js";

export type MaterializedProjectionEntry = Readonly<{
  section: ProjectionSectionName;
  identity: string;
  value: unknown;
}>;

type SectionCodec = Readonly<{
  empty: () => unknown;
  entries: (projection: Projection) => readonly Readonly<{ identity: string; value: unknown }>[];
  assign: (projection: Projection, identity: string, value: unknown) => void;
  isValue: (identity: string, value: unknown) => boolean;
}>;

const SECTION_CODECS = {
  nodes: indexed("nodes", isNode),
  occurrences: indexed("occurrences", isOccurrence),
  children: indexed("children", (_identity, value) => isStringArray(value)),
  nodeOwners: indexed("nodeOwners", (_identity, value) => isNodeOwner(value)),
  addressedValues: indexed("addressedValues", (_identity, value) => isRecord(value)),
  schemaApplications: stringArraySection("schemaApplications"),
  schemaFields: stringArraySection("schemaFields"),
  templateFields: schemaSection("templateFields"),
  schemaTemplateNodes: stringArraySection("schemaTemplateNodes"),
  templateNodeInstances: sequence(isTemplateNodeInstance),
  schemaExtensions: stringArraySection("schemaExtensions"),
  schemaSearchMembers: stringArraySection("schemaSearchMembers"),
  schemaExtensionConflicts: stringArraySection("schemaExtensionConflicts"),
  nodeStatuses: indexed("nodeStatuses", isNodeStatus),
  conflictIssues: indexed("conflictIssues", isConflictIssue),
  effectiveFields: schemaSection("effectiveFields"),
  materializedFields: indexed("materializedFields", (_identity, value) =>
    isMaterializedFields(value),
  ),
} satisfies Readonly<Record<ProjectionSectionName, SectionCodec>>;

export function emptyMaterializedProjection(
  view: ViewMode,
  identity: ProjectionIdentity,
): Projection {
  const sections = Object.fromEntries(
    PROJECTION_SECTION_NAMES.map((section) => [section, SECTION_CODECS[section].empty()]),
  ) as ProjectionSections;
  return { view, identity, ...sections };
}

export function materializedProjectionEntries(
  projection: Projection,
): readonly MaterializedProjectionEntry[] {
  return PROJECTION_SECTION_NAMES.flatMap((section) =>
    SECTION_CODECS[section]
      .entries(projection)
      .map((entry) => ({ section, identity: entry.identity, value: entry.value })),
  );
}

export function assignMaterializedProjectionValue(
  projection: Projection,
  section: ProjectionSectionName,
  identity: string,
  value: unknown,
): void {
  SECTION_CODECS[section].assign(projection, identity, value);
}

export function isMaterializedProjectionValue(
  section: ProjectionSectionName,
  identity: string,
  value: unknown,
): boolean {
  return SECTION_CODECS[section].isValue(identity, value);
}

function indexed(
  section: Exclude<ProjectionSectionName, "templateNodeInstances">,
  isValue: (identity: string, value: unknown) => boolean,
): SectionCodec {
  return {
    empty: () => ({}),
    entries: (projection) =>
      Object.entries(projection[section] as Readonly<Record<string, unknown>>).map(
        ([identity, value]) => ({ identity, value }),
      ),
    assign: (projection, identity, value) => {
      (projection[section] as Record<string, unknown>)[identity] = value;
    },
    isValue,
  };
}

function sequence(isValue: (value: unknown) => boolean): SectionCodec {
  return {
    empty: () => [],
    entries: (projection) =>
      projection.templateNodeInstances.map((value, index) => ({ identity: String(index), value })),
    assign: (projection, identity, value) => {
      (projection.templateNodeInstances as unknown[])[Number(identity)] = value;
    },
    isValue: (identity, value) => isSequenceIdentity(identity) && isValue(value),
  };
}

function stringArraySection(
  section: Exclude<ProjectionSectionName, "templateNodeInstances">,
): SectionCodec {
  return indexed(section, (_identity, value) => isStringArray(value));
}

function schemaSection(section: "templateFields" | "effectiveFields"): SectionCodec {
  return indexed(section, (_identity, value) => isSchemaSectionValue(section, value) === true);
}

function isSequenceIdentity(identity: string): boolean {
  return /^(0|[1-9]\d*)$/.test(identity) && Number.isSafeInteger(Number(identity));
}

function isNode(identity: string, value: unknown): boolean {
  return (
    hasExactKeys(value, ["nodeId", "text", "properties", "metadata"]) &&
    value.nodeId === identity &&
    Array.isArray(value.text) &&
    value.text.every(isTextAtom) &&
    isRecord(value.properties) &&
    isRecord(value.metadata)
  );
}

function isTextAtom(value: unknown): boolean {
  return (
    hasExactKeys(value, ["id", "value", "attributes", "contributionId"]) &&
    typeof value.id === "string" &&
    typeof value.value === "string" &&
    isRecord(value.attributes) &&
    typeof value.contributionId === "string"
  );
}

function isOccurrence(identity: string, value: unknown): boolean {
  return (
    hasExactKeys(value, [
      "occurrenceId",
      "nodeId",
      "parentNodeId",
      "properties",
      "metadata",
      "derived",
    ]) &&
    value.occurrenceId === identity &&
    typeof value.nodeId === "string" &&
    typeof value.parentNodeId === "string" &&
    isRecord(value.properties) &&
    isRecord(value.metadata) &&
    typeof value.derived === "boolean"
  );
}

function isNodeOwner(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isConflictIssue(identity: string, value: unknown): boolean {
  return isRecord(value) && value.identity === identity && typeof value.kind === "string";
}

function isNodeStatus(identity: string, value: unknown): boolean {
  return (
    hasExactKeys(value, ["nodeId", "nodeType", "state", "deletionFactIds"]) &&
    value.nodeId === identity &&
    (value.nodeType === null || isNodeType(value.nodeType)) &&
    (value.state === "active" || value.state === "deleted") &&
    isStringArray(value.deletionFactIds)
  );
}

function isMaterializedFields(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (field) =>
        hasExactKeys(field, [
          "ownerNodeId",
          "fieldDefinitionId",
          "fieldNodeId",
          "fieldOccurrenceId",
          "valueOccurrenceIds",
        ]) &&
        typeof field.ownerNodeId === "string" &&
        typeof field.fieldDefinitionId === "string" &&
        typeof field.fieldNodeId === "string" &&
        typeof field.fieldOccurrenceId === "string" &&
        isStringArray(field.valueOccurrenceIds),
    )
  );
}

function isTemplateNodeInstance(value: unknown): boolean {
  return (
    hasExactKeys(value, [
      "ownerNodeId",
      "templateNodeId",
      "instanceNodeId",
      "instanceOccurrenceId",
      "state",
      "sources",
      "detachmentContributionIds",
    ]) &&
    typeof value.ownerNodeId === "string" &&
    typeof value.templateNodeId === "string" &&
    (value.instanceNodeId === null || typeof value.instanceNodeId === "string") &&
    typeof value.instanceOccurrenceId === "string" &&
    (value.state === "linked" || value.state === "detached") &&
    Array.isArray(value.sources) &&
    value.sources.every(
      (source) =>
        hasExactKeys(source, ["schemaId", "appliedSchemaId", "templateOccurrenceId"]) &&
        Object.values(source).every((item) => typeof item === "string"),
    ) &&
    isStringArray(value.detachmentContributionIds)
  );
}
