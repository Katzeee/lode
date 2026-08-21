import { stableStringCompare } from "../../../../../domain/fact/index.js";
import type { DocumentStore, LoadedDocumentBytes } from "../../../../persistence/index.js";
import type { MaterializedDatasetCatalog, MaterializedDatasetRoot } from "./materialized-dataset.js";
import {
  SHARD_FORMAT,
  directoryNodeDocumentId,
  directoryPrefix,
  encodeMaterialized,
  headerDocumentId,
  shardPrefix,
  type DirectoryNodeReference,
  type DirectoryRoot,
  type MaterializedGeneration,
  type ShardDescriptor,
  type StoredDirectoryNode,
  type StoredShard,
} from "./materialized-generation-format.js";
import { isStoredDirectoryNode } from "./materialized-format-validation.js";
import { MaterializedGenerationCorruptError, MaterializedGenerationUnavailableError } from "./errors.js";

export async function writeMaterializedEntry(
  documents: DocumentStore,
  generationId: string,
  shard: Readonly<{ descriptor: ShardDescriptor; value: unknown }>,
): Promise<void> {
  await documents.writeSnapshot(
    shard.descriptor.documentId,
    encodeMaterialized({
      format: SHARD_FORMAT,
      generationId,
      key: shard.descriptor.key,
      contentDigest: shard.descriptor.contentDigest,
      value: shard.value,
    } satisfies StoredShard),
  );
}

export async function writeDirectoryNodes(
  documents: DocumentStore,
  nodes: MaterializedGeneration["directoryNodes"],
): Promise<void> {
  for (const node of nodes) {
    await documents.writeSnapshot(
      directoryNodeDocumentId(node.generationId, node, node.contentDigest),
      encodeMaterialized(node),
    );
  }
}

export async function loadAllDescriptors<Identity>(
  documents: DocumentStore,
  generationId: string,
  roots: readonly DirectoryRoot[],
  catalog: MaterializedDatasetCatalog<Identity>,
): Promise<readonly ShardDescriptor[]> {
  const descriptors: ShardDescriptor[] = [];
  for (const root of roots) {
    await collectDescriptors(documents, generationId, root, root, null, Number.MAX_SAFE_INTEGER, descriptors, catalog);
  }
  return descriptors;
}

export async function loadPageDescriptors<Identity>(
  documents: DocumentStore,
  generationId: string,
  root: MaterializedDatasetRoot,
  directory: DirectoryRoot,
  after: string | null,
  limit: number,
  catalog: MaterializedDatasetCatalog<Identity>,
): Promise<Readonly<{ descriptors: readonly ShardDescriptor[]; hasMore: boolean }>> {
  const descriptors: ShardDescriptor[] = [];
  await collectDescriptors(documents, generationId, root, directory, after, limit + 1, descriptors, catalog);
  return { descriptors: descriptors.slice(0, limit), hasMore: descriptors.length > limit };
}

export async function loadExactDescriptors<Identity>(
  documents: DocumentStore,
  generationId: string,
  root: MaterializedDatasetRoot,
  directory: DirectoryRoot,
  identities: readonly string[],
  catalog: MaterializedDatasetCatalog<Identity>,
): Promise<readonly ShardDescriptor[]> {
  const descriptors = await Promise.all(
    identities.map((identity) => findDescriptor(documents, generationId, root, directory, identity, catalog)),
  );
  return descriptors.filter((descriptor): descriptor is ShardDescriptor => descriptor !== null);
}

async function collectDescriptors<Identity>(
  documents: DocumentStore,
  generationId: string,
  root: MaterializedDatasetRoot,
  reference: DirectoryNodeReference,
  after: string | null,
  limit: number,
  output: ShardDescriptor[],
  catalog: MaterializedDatasetCatalog<Identity>,
): Promise<void> {
  if (
    output.length >= limit ||
    reference.count === 0 ||
    (after !== null && reference.maxIdentity !== null && stableStringCompare(reference.maxIdentity, after) <= 0)
  ) {
    return;
  }
  const node = await loadDirectoryNode(documents, generationId, root, reference, catalog);
  if (node.level === 0) {
    for (const descriptor of node.entries ?? []) {
      if (after === null || stableStringCompare(descriptor.identity, after) > 0) {
        output.push(descriptor);
        if (output.length >= limit) {
          return;
        }
      }
    }
    return;
  }
  for (const child of node.children ?? []) {
    await collectDescriptors(documents, generationId, root, child, after, limit, output, catalog);
    if (output.length >= limit) {
      return;
    }
  }
}

async function findDescriptor<Identity>(
  documents: DocumentStore,
  generationId: string,
  root: MaterializedDatasetRoot,
  reference: DirectoryNodeReference,
  identity: string,
  catalog: MaterializedDatasetCatalog<Identity>,
): Promise<ShardDescriptor | null> {
  if (
    reference.count === 0 ||
    reference.minIdentity === null ||
    reference.maxIdentity === null ||
    stableStringCompare(identity, reference.minIdentity) < 0 ||
    stableStringCompare(identity, reference.maxIdentity) > 0
  ) {
    return null;
  }
  const node = await loadDirectoryNode(documents, generationId, root, reference, catalog);
  if (node.level === 0) {
    return node.entries?.find((descriptor) => descriptor.identity === identity) ?? null;
  }
  const child = node.children?.find(
    (candidate) =>
      candidate.minIdentity !== null &&
      candidate.maxIdentity !== null &&
      stableStringCompare(identity, candidate.minIdentity) >= 0 &&
      stableStringCompare(identity, candidate.maxIdentity) <= 0,
  );
  return child ? findDescriptor(documents, generationId, root, child, identity, catalog) : null;
}

async function loadDirectoryNode<Identity>(
  documents: DocumentStore,
  generationId: string,
  root: MaterializedDatasetRoot,
  reference: DirectoryNodeReference,
  catalog: MaterializedDatasetCatalog<Identity>,
): Promise<StoredDirectoryNode> {
  const stored = await documents.load(reference.documentId);
  if (!stored) {
    throw new MaterializedGenerationUnavailableError("Published materialized dataset directory is unavailable");
  }
  return parseDirectoryNode(generationId, root, reference, stored, catalog);
}

function parseDirectoryNode<Identity>(
  generationId: string,
  root: MaterializedDatasetRoot,
  reference: DirectoryNodeReference,
  stored: LoadedDocumentBytes,
  catalog: MaterializedDatasetCatalog<Identity>,
): StoredDirectoryNode {
  if (!stored.snapshot || stored.updates.length > 0) {
    throw new MaterializedGenerationCorruptError("Published materialized dataset directory is corrupt");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(stored.snapshot));
  } catch (error) {
    throw new MaterializedGenerationCorruptError("Published materialized dataset directory is corrupt", {
      cause: error,
    });
  }
  if (!isStoredDirectoryNode(parsed, generationId, reference, root, catalog)) {
    throw new MaterializedGenerationCorruptError("Published materialized dataset directory is corrupt");
  }
  return parsed;
}

export async function deleteGenerationDocuments(documents: DocumentStore, generationId: string): Promise<void> {
  for (const prefix of [shardPrefix(generationId), directoryPrefix(generationId)]) {
    for (const id of await documents.listIds({ prefix })) {
      await documents.delete(id);
    }
  }
  await documents.delete(headerDocumentId(generationId));
}

export async function deleteOrphanMaterializedDocuments(
  documents: DocumentStore,
  retained: ReadonlySet<string>,
): Promise<void> {
  for (const root of ["materialized-generation/shard/", "materialized-generation/directory/"]) {
    for (const id of await documents.listIds({ prefix: root })) {
      const generationId = id.slice(root.length).split("/")[0];
      if (generationId && !retained.has(generationId)) {
        await documents.delete(id);
      }
    }
  }
}
