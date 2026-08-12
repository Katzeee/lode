import { canonicalDigest, type ViewMode } from "../../domain/fact/index.js";
import {
  OWNER_CACHE_FORMAT,
  PROJECTION_SECTIONS,
  SHARD_FORMAT,
  ownerCacheDocumentId,
  projectionShardKey,
  shardDocumentId,
  type ProjectionSection,
  type ShardDescriptor,
  type StoredOwnerCaches,
  type StoredShard,
} from "./materialized-generation-format.js";
import { isSchemaSectionValue } from "./materialized-schema-value-validation.js";

export function isStoredOwnerCaches(
  value: unknown,
  generationId: string,
  contentDigest: string,
): value is StoredOwnerCaches {
  return (
    hasExactKeys(value, ["format", "generationId", "contentDigest", "value"]) &&
    value.format === OWNER_CACHE_FORMAT &&
    value.generationId === generationId &&
    value.contentDigest === contentDigest &&
    canonicalDigest(value.value) === contentDigest &&
    isOwnerCaches(value.value)
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
    !hasExactKeys(value, ["generationId", "frontier", "rulesVersion", "schemaVersion"]) ||
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

export function isOwnerCacheDescriptor(value: unknown, generationId: string): boolean {
  return (
    hasExactKeys(value, ["documentId", "contentDigest"]) &&
    value.documentId === ownerCacheDocumentId(generationId) &&
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

function isOwnerCaches(value: unknown): boolean {
  if (!hasExactKeys(value, ["origin", "review"])) {
    return false;
  }
  return [value.origin, value.review].every(
    (cache) =>
      hasExactKeys(cache, ["activeContributionIds", "supportPasses"]) &&
      Array.isArray(cache.activeContributionIds) &&
      cache.activeContributionIds.every((id) => typeof id === "string") &&
      Number.isSafeInteger(cache.supportPasses) &&
      (cache.supportPasses as number) >= 0,
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
        "parentOccurrenceId",
        "properties",
        "metadata",
        "managed",
      ]) &&
      value.occurrenceId === identity &&
      typeof value.nodeId === "string" &&
      (value.parentOccurrenceId === null || typeof value.parentOccurrenceId === "string") &&
      isRecord(value.properties) &&
      isRecord(value.metadata) &&
      typeof value.managed === "boolean"
    );
  }
  if (
    section === "children" ||
    section === "schemaApplications" ||
    section === "schemaFields" ||
    section === "schemaExtensions" ||
    section === "schemaSearchMembers" ||
    section === "schemaExtensionConflicts" ||
    section.startsWith("managedChildrenBy") ||
    section === "occurrenceIdsByNode" ||
    section === "nodeIdsBySchema"
  ) {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
  }
  if (section === "canonicalOccurrences") {
    return typeof value === "string";
  }
  if (section === "conflictIssues") {
    return isRecord(value) && value.identity === identity && typeof value.kind === "string";
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
  return (
    hasExactKeys(value, ["parentNodeId", "schemaId", "fieldId", "nodeId", "occurrenceId"]) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}
