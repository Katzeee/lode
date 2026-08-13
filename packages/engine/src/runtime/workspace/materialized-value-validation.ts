import { canonicalDigest, type ViewMode } from "../../domain/fact/index.js";
import {
  PLAN_CACHE_FORMAT,
  PROJECTION_SECTIONS,
  SHARD_FORMAT,
  planCacheDocumentId,
  projectionShardKey,
  shardDocumentId,
  type ProjectionSection,
  type ShardDescriptor,
  type StoredPlanCaches,
  type StoredShard,
} from "./materialized-generation-format.js";
import { isSchemaSectionValue } from "./materialized-schema-value-validation.js";

export function isStoredPlanCaches(
  value: unknown,
  generationId: string,
  contentDigest: string,
): value is StoredPlanCaches {
  return (
    hasExactKeys(value, ["format", "generationId", "contentDigest", "value"]) &&
    value.format === PLAN_CACHE_FORMAT &&
    value.generationId === generationId &&
    value.contentDigest === contentDigest &&
    canonicalDigest(value.value) === contentDigest &&
    isPlanCaches(value.value)
  );
}

export function isStoredShard(
  value: unknown,
  generationId: string,
  descriptor: ShardDescriptor,
): value is StoredShard {
  return (
    hasExactKeys(value, ["format", "generationId", "key", "contentDigest", "value"]) &&
    value.format === SHARD_FORMAT &&
    value.generationId === generationId &&
    value.key === descriptor.key &&
    value.contentDigest === descriptor.contentDigest &&
    canonicalDigest(value.value) === descriptor.contentDigest &&
    isSectionValue(descriptor.section, descriptor.identity, value.value)
  );
}

export function isProjectionHeader(value: unknown, view: ViewMode, generationId: string): boolean {
  return (
    hasExactKeys(value, ["view", "identity"]) &&
    value.view === view &&
    isProjectionIdentity(value.identity, generationId)
  );
}

export function isShardDescriptor(
  value: unknown,
  generationId: string,
  view?: ViewMode,
  section?: ProjectionSection,
): value is ShardDescriptor {
  if (
    !hasExactKeys(value, ["documentId", "key", "view", "section", "identity", "contentDigest"]) ||
    typeof value.documentId !== "string" ||
    typeof value.key !== "string" ||
    (value.view !== "origin" && value.view !== "review") ||
    !PROJECTION_SECTIONS.includes(value.section as ProjectionSection) ||
    typeof value.identity !== "string" ||
    typeof value.contentDigest !== "string" ||
    (view !== undefined && value.view !== view) ||
    (section !== undefined && value.section !== section)
  ) {
    return false;
  }
  const key = projectionShardKey(value.view, value.section as ProjectionSection, value.identity);
  return value.key === key && value.documentId === shardDocumentId(generationId, key);
}

export function isProjectionIdentity(value: unknown, generationId: string): boolean {
  if (
    !hasExactKeys(value, [
      "workspaceNodeId",
      "generationId",
      "frontier",
      "rulesVersion",
      "schemaVersion",
    ]) ||
    typeof value.workspaceNodeId !== "string" ||
    value.generationId !== generationId ||
    typeof value.rulesVersion !== "string" ||
    typeof value.schemaVersion !== "string" ||
    !isRecord(value.frontier)
  ) {
    return false;
  }
  return Object.entries(value.frontier).every(
    ([replicaId, sequence]) =>
      /^[a-z2-7]{26}$/.test(replicaId) &&
      Number.isSafeInteger(sequence) &&
      (sequence as number) >= 0,
  );
}

export function isPlanCacheDescriptor(value: unknown, generationId: string): boolean {
  return (
    hasExactKeys(value, ["documentId", "contentDigest"]) &&
    value.documentId === planCacheDocumentId(generationId) &&
    typeof value.contentDigest === "string"
  );
}

export function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasExactKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

function isPlanCaches(value: unknown): boolean {
  if (!hasExactKeys(value, ["origin", "review"])) {
    return false;
  }
  return [value.origin, value.review].every(
    (cache) =>
      hasExactKeys(cache, ["activeContributionIds", "supportByContribution", "supportPasses"]) &&
      Array.isArray(cache.activeContributionIds) &&
      cache.activeContributionIds.every((id) => typeof id === "string") &&
      isStringArrayRecord(cache.supportByContribution) &&
      Number.isSafeInteger(cache.supportPasses) &&
      (cache.supportPasses as number) >= 0,
  );
}

function isStringArrayRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (entry) => Array.isArray(entry) && entry.every((item) => typeof item === "string"),
    )
  );
}

function isSectionValue(section: ProjectionSection, identity: string, value: unknown): boolean {
  const schemaValue = isSchemaSectionValue(section, value);
  if (schemaValue !== null) {
    return schemaValue;
  }
  if (section === "nodes") {
    return (
      hasExactKeys(value, ["nodeId", "text", "properties", "metadata"]) &&
      value.nodeId === identity &&
      Array.isArray(value.text) &&
      isRecord(value.properties) &&
      isRecord(value.metadata)
    );
  }
  if (section === "occurrences") {
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
  if (
    section === "children" ||
    section === "schemaApplications" ||
    section === "schemaFields" ||
    section === "schemaTemplateNodes" ||
    section === "schemaExtensions" ||
    section === "schemaSearchMembers" ||
    section === "schemaExtensionConflicts" ||
    section.startsWith("templateNodeInstancesBy") ||
    section === "occurrenceIdsByNode" ||
    section === "nodeIdsByOwner" ||
    section === "nodeIdsBySchema" ||
    section === "nodeIdsByFieldDefinition" ||
    section === "reviewScopes" ||
    section === "supportByContribution"
  ) {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
  }
  if (section === "nodeOwners") {
    return isNodeOwner(value);
  }
  if (section === "schemaInstanceMemberships") {
    return typeof value === "string";
  }
  if (section === "conflictIssues") {
    return isRecord(value) && value.identity === identity && typeof value.kind === "string";
  }
  if (section === "nodeStatuses") {
    return (
      hasExactKeys(value, ["nodeId", "roles", "state", "deletionFactIds"]) &&
      value.nodeId === identity &&
      Array.isArray(value.roles) &&
      value.roles.every((role) => role === "schema" || role === "field") &&
      (value.state === "active" || value.state === "deleted") &&
      Array.isArray(value.deletionFactIds) &&
      value.deletionFactIds.every((factId) => typeof factId === "string")
    );
  }
  if (section === "addressedValues") {
    return isRecord(value);
  }
  if (section === "materializedFields") {
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
          Array.isArray(field.valueOccurrenceIds) &&
          field.valueOccurrenceIds.every((id) => typeof id === "string"),
      )
    );
  }
  if (section === "templateNodeInstances") {
    return isTemplateNodeInstance(value);
  }
  return false;
}

function isNodeOwner(value: unknown): boolean {
  return value === null || typeof value === "string";
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
    Array.isArray(value.detachmentContributionIds) &&
    value.detachmentContributionIds.every((item) => typeof item === "string")
  );
}
