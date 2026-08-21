import { canonicalDigest, stableStringCompare } from "../../../../../domain/fact/index.js";
import type { MaterializedDatasetCatalog, MaterializedDatasetRoot } from "./materialized-dataset.js";
import { materializedDatasetRootKey, sameMaterializedDatasetRoot } from "./materialized-dataset.js";
import {
  DIRECTORY_FORMAT,
  HEADER_FORMAT,
  directoryNodeDocumentId,
  type DirectoryNodeReference,
  type GenerationHeader,
  type StoredDirectoryNode,
} from "./materialized-generation-format.js";
import { isNullableString, isShardDescriptor } from "./materialized-value-validation.js";
import { hasExactKeys, isRecord } from "../../../../../decoding/index.js";
export { isStoredShard } from "./materialized-value-validation.js";

export function isGenerationHeader<Identity>(
  value: unknown,
  generationId: string,
  catalog: MaterializedDatasetCatalog<Identity>,
): value is GenerationHeader<Identity> {
  if (
    !hasExactKeys(value, ["format", "contentDigest", "identity", "directory"]) ||
    value.format !== HEADER_FORMAT ||
    !catalog.isGenerationIdentity(value.identity, generationId) ||
    typeof value.contentDigest !== "string" ||
    !isDirectoryRoots(value.directory, generationId, catalog)
  ) {
    return false;
  }
  const { contentDigest: _contentDigest, ...content } = value as GenerationHeader<Identity>;
  return value.contentDigest === canonicalDigest(content);
}

export function isStoredDirectoryNode<Identity>(
  value: unknown,
  generationId: string,
  expected: DirectoryNodeReference,
  root: MaterializedDatasetRoot,
  catalog: MaterializedDatasetCatalog<Identity>,
): value is StoredDirectoryNode {
  if (
    !isRecord(value) ||
    value.format !== DIRECTORY_FORMAT ||
    value.generationId !== generationId ||
    !sameMaterializedDatasetRoot(value as MaterializedDatasetRoot, root) ||
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
    "dataset",
    "partition",
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
  return isLeaf ? isValidLeaf(value, generationId, root, catalog) : isValidBranch(value, generationId, root);
}

function isValidLeaf<Identity>(
  value: Record<string, unknown>,
  generationId: string,
  root: MaterializedDatasetRoot,
  catalog: MaterializedDatasetCatalog<Identity>,
): boolean {
  if (
    !Array.isArray(value.entries) ||
    value.entries.length !== value.count ||
    !value.entries.every((entry) => isShardDescriptor(entry, generationId, catalog, root))
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

function isValidBranch(value: Record<string, unknown>, generationId: string, root: MaterializedDatasetRoot): boolean {
  if (
    !Array.isArray(value.children) ||
    value.children.length < 1 ||
    !value.children.every((child) => isDirectoryReference(child, generationId, root)) ||
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

function isDirectoryRoots<Identity>(
  value: unknown,
  generationId: string,
  catalog: MaterializedDatasetCatalog<Identity>,
): boolean {
  if (!Array.isArray(value) || value.length !== catalog.roots.length) {
    return false;
  }
  const expected = new Set(catalog.roots.map(materializedDatasetRootKey));
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
        "dataset",
        "partition",
        "section",
      ]) ||
      typeof root.dataset !== "string" ||
      typeof root.partition !== "string" ||
      typeof root.section !== "string" ||
      !catalog.isRoot(root as MaterializedDatasetRoot)
    ) {
      return false;
    }
    const datasetRoot = root as MaterializedDatasetRoot;
    if (!isDirectoryReference(root, generationId, datasetRoot, true)) {
      return false;
    }
    expected.delete(materializedDatasetRootKey(datasetRoot));
  }
  return expected.size === 0;
}

function isDirectoryReference(
  value: unknown,
  generationId: string,
  root: MaterializedDatasetRoot,
  includesRoot = false,
): value is DirectoryNodeReference {
  const keys = ["documentId", "contentDigest", "level", "count", "minIdentity", "maxIdentity"];
  if (
    !hasExactKeys(value, includesRoot ? [...keys, "dataset", "partition", "section"] : keys) ||
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
  return value.documentId === directoryNodeDocumentId(generationId, root, value.contentDigest);
}

function matchesReference(value: Record<string, unknown>, reference: DirectoryNodeReference): boolean {
  return (
    value.contentDigest === reference.contentDigest &&
    value.level === reference.level &&
    value.count === reference.count &&
    value.minIdentity === reference.minIdentity &&
    value.maxIdentity === reference.maxIdentity
  );
}

function isStrictlyOrdered(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || stableStringCompare(values[index - 1] ?? "", value) < 0);
}
