import { canonicalDigest, stableStringCompare } from "../../domain/fact/index.js";
import type {
  MaterializedDatasetCatalog,
  MaterializedDatasetEntry,
  MaterializedDatasetRoot,
} from "./materialized-dataset.js";
import { sameMaterializedDatasetRoot } from "./materialized-dataset.js";
import {
  DIRECTORY_FANOUT,
  DIRECTORY_FORMAT,
  HEADER_FORMAT,
  directoryNodeDocumentId,
  materializedShardKey,
  shardDocumentId,
  type DirectoryNodeReference,
  type DirectoryRoot,
  type GenerationHeader,
  type MaterializedGeneration,
  type ShardDescriptor,
  type StoredDirectoryNode,
} from "./materialized-generation-format.js";

export function materialize<Identity extends Readonly<{ generationId: string }>>(
  identity: Identity,
  entries: readonly MaterializedDatasetEntry[],
  catalog: MaterializedDatasetCatalog<Identity>,
): MaterializedGeneration<Identity> {
  const shards = entries
    .map((entry) => materializedShard(identity.generationId, entry, catalog))
    .sort((left, right) => stableStringCompare(left.descriptor.key, right.descriptor.key));
  const directory = buildDirectory(
    identity.generationId,
    catalog.roots,
    shards.map((shard) => shard.descriptor),
  );
  return {
    header: withHeaderDigest({
      format: HEADER_FORMAT,
      identity,
      directory: directory.roots,
    }),
    shards,
    directoryNodes: directory.nodes,
  };
}

function materializedShard<Identity>(
  generationId: string,
  entry: MaterializedDatasetEntry,
  catalog: MaterializedDatasetCatalog<Identity>,
): Readonly<{ descriptor: ShardDescriptor; value: unknown }> {
  if (!catalog.isRoot(entry) || !catalog.isValue(entry, entry.identity, entry.value)) {
    throw new Error("Materialized dataset entry does not satisfy its dataset contract");
  }
  const key = materializedShardKey(entry, entry.identity);
  return {
    descriptor: {
      documentId: shardDocumentId(generationId, key),
      key,
      dataset: entry.dataset,
      partition: entry.partition,
      section: entry.section,
      identity: entry.identity,
      contentDigest: canonicalDigest(entry.value),
    },
    value: entry.value,
  };
}

function buildDirectory(
  generationId: string,
  roots: readonly MaterializedDatasetRoot[],
  descriptors: readonly ShardDescriptor[],
): Readonly<{ roots: readonly DirectoryRoot[]; nodes: readonly StoredDirectoryNode[] }> {
  const directoryRoots: DirectoryRoot[] = [];
  const nodes: StoredDirectoryNode[] = [];
  for (const root of roots) {
    const selected = descriptors
      .filter((descriptor) => sameMaterializedDatasetRoot(descriptor, root))
      .sort((left, right) => stableStringCompare(left.identity, right.identity));
    const tree = buildDirectoryTree(generationId, root, selected);
    directoryRoots.push({ ...tree.root, ...root });
    nodes.push(...tree.nodes);
  }
  return { roots: directoryRoots, nodes };
}

function buildDirectoryTree(
  generationId: string,
  root: MaterializedDatasetRoot,
  descriptors: readonly ShardDescriptor[],
): Readonly<{ root: DirectoryNodeReference; nodes: readonly StoredDirectoryNode[] }> {
  const nodes: StoredDirectoryNode[] = [];
  let level = chunk(descriptors, DIRECTORY_FANOUT).map((entries) => {
    const node = directoryNode(generationId, root, 0, entries, undefined);
    nodes.push(node);
    return directoryNodeReference(generationId, node);
  });
  if (level.length === 0) {
    const node = directoryNode(generationId, root, 0, [], undefined);
    nodes.push(node);
    level = [directoryNodeReference(generationId, node)];
  }
  while (level.length > 1) {
    level = chunk(level, DIRECTORY_FANOUT).map((children) => {
      const node = directoryNode(generationId, root, (children[0]?.level ?? 0) + 1, undefined, children);
      nodes.push(node);
      return directoryNodeReference(generationId, node);
    });
  }
  const directoryRoot = level[0];
  if (!directoryRoot) {
    throw new Error("Materialized directory root is absent");
  }
  return { root: directoryRoot, nodes };
}

function directoryNode(
  generationId: string,
  root: MaterializedDatasetRoot,
  level: number,
  entries: readonly ShardDescriptor[] | undefined,
  children: readonly DirectoryNodeReference[] | undefined,
): StoredDirectoryNode {
  const count = entries ? entries.length : (children?.reduce((sum, child) => sum + child.count, 0) ?? 0);
  const minIdentity = entries ? (entries[0]?.identity ?? null) : (children?.[0]?.minIdentity ?? null);
  const maxIdentity = entries ? (entries.at(-1)?.identity ?? null) : (children?.at(-1)?.maxIdentity ?? null);
  const content: Omit<StoredDirectoryNode, "contentDigest"> = {
    format: DIRECTORY_FORMAT,
    generationId,
    ...root,
    level,
    count,
    minIdentity,
    maxIdentity,
    ...(entries ? { entries } : { children: children ?? [] }),
  };
  const contentDigest = canonicalDigest(content);
  return { ...content, contentDigest };
}

function directoryNodeReference(generationId: string, node: StoredDirectoryNode): DirectoryNodeReference {
  return {
    documentId: directoryNodeDocumentId(generationId, node, node.contentDigest),
    contentDigest: node.contentDigest,
    level: node.level,
    count: node.count,
    minIdentity: node.minIdentity,
    maxIdentity: node.maxIdentity,
  };
}

function chunk<T>(values: readonly T[], size: number): readonly (readonly T[])[] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function withHeaderDigest<Identity>(
  header: Omit<GenerationHeader<Identity>, "contentDigest">,
): GenerationHeader<Identity> {
  return { ...header, contentDigest: canonicalDigest(header) };
}
