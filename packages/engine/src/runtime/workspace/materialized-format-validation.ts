import { canonicalDigest, stableStringCompare, type ViewMode } from "../../domain/fact/index.js";
import {
  DIRECTORY_FORMAT,
  HEADER_FORMAT,
  MANIFEST_FORMAT,
  OWNER_CACHE_FORMAT,
  PROJECTION_SECTIONS,
  SHARD_FORMAT,
  directoryNodeDocumentId,
  ownerCacheDocumentId,
  projectionShardKey,
  shardDocumentId,
  type DirectoryNodeReference,
  type GenerationHeader,
  type GenerationManifest,
  type ProjectionSection,
  type ShardDescriptor,
  type StoredDirectoryNode,
  type StoredOwnerCaches,
  type StoredShard,
} from "./materialized-generation-format.js";

export function isManifest(value: unknown): value is GenerationManifest {
  return (
    hasExactKeys(value, ["format", "generationIds"]) &&
    value.format === MANIFEST_FORMAT &&
    Array.isArray(value.generationIds) &&
    value.generationIds.length <= 2 &&
    value.generationIds.every((generationId) => typeof generationId === "string")
  );
}

export function isGenerationHeader(
  value: unknown,
  generationId: string,
): value is GenerationHeader {
  if (
    !hasExactKeys(value, [
      "format",
      "contentDigest",
      "identity",
      "ownerCache",
      "directory",
      "origin",
      "review",
    ]) ||
    value.format !== HEADER_FORMAT ||
    !isProjectionIdentity(value.identity, generationId) ||
    typeof value.contentDigest !== "string" ||
    !isOwnerCacheDescriptor(value.ownerCache, generationId) ||
    !isDirectoryRoots(value.directory, generationId) ||
    !isProjectionHeader(value.origin, "origin", generationId) ||
    !isProjectionHeader(value.review, "review", generationId)
  ) {
    return false;
  }
  const { contentDigest: _contentDigest, ...content } = value as GenerationHeader;
  return value.contentDigest === canonicalDigest(content);
}

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

export function isStoredDirectoryNode(
  value: unknown,
  generationId: string,
  expected: DirectoryNodeReference,
  view: ViewMode,
  section: ProjectionSection,
): value is StoredDirectoryNode {
  if (
    !isRecord(value) ||
    value.format !== DIRECTORY_FORMAT ||
    value.generationId !== generationId ||
    value.view !== view ||
    value.section !== section ||
    typeof value.contentDigest !== "string" ||
    value.contentDigest !== expected.contentDigest ||
    !Number.isSafeInteger(value.level) ||
    (value.level as number) < 0 ||
    !Number.isSafeInteger(value.count) ||
    (value.count as number) < 0 ||
    !isNullableString(value.minIdentity) ||
    !isNullableString(value.maxIdentity)
  ) {
    return false;
  }
  const commonKeys = [
    "format",
    "generationId",
    "contentDigest",
    "view",
    "section",
    "level",
    "count",
    "minIdentity",
    "maxIdentity",
  ];
  const isLeaf = value.level === 0;
  if (!hasExactKeys(value, [...commonKeys, isLeaf ? "entries" : "children"])) {
    return false;
  }
  if (!matchesReference(value, expected)) {
    return false;
  }
  const { contentDigest: _contentDigest, ...content } = value;
  if (canonicalDigest(content) !== value.contentDigest) {
    return false;
  }
  return isLeaf
    ? isValidLeaf(value, generationId, view, section)
    : isValidBranch(value, generationId, view, section);
}

function isValidLeaf(
  value: Record<string, unknown>,
  generationId: string,
  view: ViewMode,
  section: ProjectionSection,
): boolean {
  if (
    !Array.isArray(value.entries) ||
    value.entries.length !== value.count ||
    !value.entries.every((entry) => isShardDescriptor(entry, generationId, view, section))
  ) {
    return false;
  }
  const entries = value.entries;
  return (
    isStrictlyOrdered(entries.map((entry) => entry.identity)) &&
    value.minIdentity === (entries[0]?.identity ?? null) &&
    value.maxIdentity === (entries.at(-1)?.identity ?? null)
  );
}

function isValidBranch(
  value: Record<string, unknown>,
  generationId: string,
  view: ViewMode,
  section: ProjectionSection,
): boolean {
  if (
    !Array.isArray(value.children) ||
    value.children.length < 1 ||
    !value.children.every((child) => isDirectoryReference(child, generationId, view, section)) ||
    !value.children.every((child) => child.level === (value.level as number) - 1)
  ) {
    return false;
  }
  const children = value.children;
  const boundaries = children.flatMap((child) => [child.minIdentity, child.maxIdentity]);
  if (boundaries.some((identity) => identity === null)) {
    return false;
  }
  for (let index = 1; index < children.length; index += 1) {
    const previous = children[index - 1];
    const current = children[index];
    if (
      !previous?.maxIdentity ||
      !current?.minIdentity ||
      stableStringCompare(previous.maxIdentity, current.minIdentity) >= 0
    ) {
      return false;
    }
  }
  return (
    value.count === children.reduce((sum, child) => sum + child.count, 0) &&
    value.minIdentity === children[0]?.minIdentity &&
    value.maxIdentity === children.at(-1)?.maxIdentity
  );
}

function isDirectoryRoots(value: unknown, generationId: string): boolean {
  if (!Array.isArray(value) || value.length !== PROJECTION_SECTIONS.length * 2) {
    return false;
  }
  const expected = new Set(
    ["origin", "review"].flatMap((view) =>
      PROJECTION_SECTIONS.map((section) => `${view}/${section}`),
    ),
  );
  for (const root of value) {
    if (
      !isRecord(root) ||
      !hasExactKeys(root, [
        "documentId",
        "contentDigest",
        "level",
        "count",
        "minIdentity",
        "maxIdentity",
        "view",
        "section",
      ]) ||
      (root.view !== "origin" && root.view !== "review") ||
      !PROJECTION_SECTIONS.includes(root.section as ProjectionSection)
    ) {
      return false;
    }
    const view = root.view;
    const section = root.section as ProjectionSection;
    if (!isDirectoryReference(root, generationId, view, section, true)) {
      return false;
    }
    expected.delete(`${view}/${section}`);
  }
  return expected.size === 0;
}

function isDirectoryReference(
  value: unknown,
  generationId: string,
  view: ViewMode,
  section: ProjectionSection,
  root = false,
): value is DirectoryNodeReference {
  const keys = ["documentId", "contentDigest", "level", "count", "minIdentity", "maxIdentity"];
  if (
    !hasExactKeys(value, root ? [...keys, "view", "section"] : keys) ||
    typeof value.documentId !== "string" ||
    typeof value.contentDigest !== "string" ||
    !Number.isSafeInteger(value.level) ||
    (value.level as number) < 0 ||
    !Number.isSafeInteger(value.count) ||
    (value.count as number) < 0 ||
    !isNullableString(value.minIdentity) ||
    !isNullableString(value.maxIdentity)
  ) {
    return false;
  }
  if ((value.count === 0) !== (value.minIdentity === null && value.maxIdentity === null)) {
    return false;
  }
  if (
    (value.count as number) > 0 &&
    (value.minIdentity === null ||
      value.maxIdentity === null ||
      stableStringCompare(value.minIdentity, value.maxIdentity) > 0)
  ) {
    return false;
  }
  return (
    value.documentId === directoryNodeDocumentId(generationId, view, section, value.contentDigest)
  );
}

function matchesReference(
  value: Record<string, unknown>,
  reference: DirectoryNodeReference,
): boolean {
  return (
    value.contentDigest === reference.contentDigest &&
    value.level === reference.level &&
    value.count === reference.count &&
    value.minIdentity === reference.minIdentity &&
    value.maxIdentity === reference.maxIdentity
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

function isProjectionHeader(value: unknown, view: ViewMode, generationId: string): boolean {
  return (
    hasExactKeys(value, ["view", "identity"]) &&
    value.view === view &&
    isProjectionIdentity(value.identity, generationId)
  );
}

function isShardDescriptor(
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

function isProjectionIdentity(value: unknown, generationId: string): boolean {
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

function isOwnerCacheDescriptor(value: unknown, generationId: string): boolean {
  return (
    hasExactKeys(value, ["documentId", "contentDigest"]) &&
    value.documentId === ownerCacheDocumentId(generationId) &&
    typeof value.contentDigest === "string"
  );
}

function isSectionValue(section: ProjectionSection, identity: string, value: unknown): boolean {
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
    section.startsWith("managedChildrenBy") ||
    section === "occurrenceIdsByNode"
  ) {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
  }
  if (section === "canonicalOccurrences") {
    return typeof value === "string";
  }
  if (section === "addressedValues") {
    return isRecord(value);
  }
  return (
    hasExactKeys(value, ["parentNodeId", "schemaId", "fieldId", "nodeId", "occurrenceId"]) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

function isStrictlyOrdered(values: readonly string[]): boolean {
  return values.every(
    (value, index) => index === 0 || stableStringCompare(values[index - 1] ?? "", value) < 0,
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}
