import { canonicalDigest, type ViewMode } from "../../domain/fact/index.js";
import {
  PLAN_CACHE_FORMAT,
  MATERIALIZED_SECTIONS,
  SHARD_FORMAT,
  planCacheDocumentId,
  projectionShardKey,
  shardDocumentId,
  type MaterializedSection,
  type ShardDescriptor,
  type StoredPlanCaches,
  type StoredShard,
} from "./materialized-generation-format.js";
import {
  isProjectionIndexSection,
  isProjectionIndexValue,
} from "./materialized-projection-index.js";
import { isMaterializedProjectionValue } from "./materialized-projection-section-codec.js";
import {
  isReviewReadModelSection,
  isReviewReadModelValue,
} from "./materialized-review-read-model.js";
import { hasExactKeys, isRecord } from "./materialized-validation-primitives.js";

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
  section?: MaterializedSection,
): value is ShardDescriptor {
  if (
    !hasExactKeys(value, ["documentId", "key", "view", "section", "identity", "contentDigest"]) ||
    typeof value.documentId !== "string" ||
    typeof value.key !== "string" ||
    (value.view !== "origin" && value.view !== "review") ||
    !MATERIALIZED_SECTIONS.includes(value.section as MaterializedSection) ||
    typeof value.identity !== "string" ||
    typeof value.contentDigest !== "string" ||
    (view !== undefined && value.view !== view) ||
    (section !== undefined && value.section !== section)
  ) {
    return false;
  }
  const key = projectionShardKey(value.view, value.section as MaterializedSection, value.identity);
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

function isSectionValue(section: MaterializedSection, identity: string, value: unknown): boolean {
  if (isReviewReadModelSection(section)) {
    return isReviewReadModelValue(value);
  }
  if (isProjectionIndexSection(section)) {
    return isProjectionIndexValue(section, value);
  }
  return isMaterializedProjectionValue(section, identity, value);
}
