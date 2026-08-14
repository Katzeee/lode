import { canonicalDigest, stableStringCompare, type ViewMode } from "../../domain/fact/index.js";
import {
  DIRECTORY_FORMAT,
  HEADER_FORMAT,
  MANIFEST_FORMAT,
  MATERIALIZED_DIRECTORY_ROOTS,
  MATERIALIZED_SECTIONS,
  directoryNodeDocumentId,
  type DirectoryNodeReference,
  type GenerationHeader,
  type GenerationManifest,
  type MaterializedSection,
  type StoredDirectoryNode,
} from "./materialized-generation-format.js";
import {
  isNullableString,
  isPlanCacheDescriptor,
  isProjectionHeader,
  isProjectionIdentity,
  isShardDescriptor,
} from "./materialized-value-validation.js";
import { hasExactKeys, isRecord } from "./materialized-validation-primitives.js";
export { isStoredPlanCaches, isStoredShard } from "./materialized-value-validation.js";

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
      "planCache",
      "directory",
      "origin",
      "review",
    ]) ||
    value.format !== HEADER_FORMAT ||
    !isProjectionIdentity(value.identity, generationId) ||
    typeof value.contentDigest !== "string" ||
    !isPlanCacheDescriptor(value.planCache, generationId) ||
    !isDirectoryRoots(value.directory, generationId) ||
    !isProjectionHeader(value.origin, "origin", generationId) ||
    !isProjectionHeader(value.review, "review", generationId)
  ) {
    return false;
  }
  const { contentDigest: _contentDigest, ...content } = value as GenerationHeader;
  return value.contentDigest === canonicalDigest(content);
}

export function isStoredDirectoryNode(
  value: unknown,
  generationId: string,
  expected: DirectoryNodeReference,
  view: ViewMode,
  section: MaterializedSection,
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
  section: MaterializedSection,
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
  section: MaterializedSection,
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
  if (!Array.isArray(value) || value.length !== MATERIALIZED_DIRECTORY_ROOTS.length) {
    return false;
  }
  const expected = new Set(
    MATERIALIZED_DIRECTORY_ROOTS.map(({ view, section }) => `${view}/${section}`),
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
      !MATERIALIZED_SECTIONS.includes(root.section as MaterializedSection)
    ) {
      return false;
    }
    const view = root.view;
    const section = root.section as MaterializedSection;
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
  section: MaterializedSection,
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

function isStrictlyOrdered(values: readonly string[]): boolean {
  return values.every(
    (value, index) => index === 0 || stableStringCompare(values[index - 1] ?? "", value) < 0,
  );
}
