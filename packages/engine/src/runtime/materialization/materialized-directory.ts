import { stableStringCompare, type ViewMode } from "../../domain/fact/index.js";
import type { DocumentStore, LoadedDocumentBytes } from "../../persistence/document-store.js";
import {
  SHARD_FORMAT,
  directoryPrefix,
  encodeMaterialized,
  headerDocumentId,
  planCacheDocumentId,
  shardPrefix,
  type DirectoryNodeReference,
  type DirectoryRoot,
  type MaterializedGeneration,
  type MaterializedSection,
  type ShardDescriptor,
  type StoredDirectoryNode,
  type StoredShard,
} from "./materialized-generation-format.js";
import { isStoredDirectoryNode } from "./materialized-format-validation.js";

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
      `${directoryPrefix(node.generationId, node.view, node.section)}${node.contentDigest}`,
      encodeMaterialized(node),
    );
  }
}

export async function loadAllDescriptors(
  documents: DocumentStore,
  generationId: string,
  roots: readonly DirectoryRoot[],
): Promise<readonly ShardDescriptor[]> {
  const descriptors: ShardDescriptor[] = [];
  for (const root of roots) {
    await collectDescriptors(
      documents,
      generationId,
      root.view,
      root.section,
      root,
      null,
      Number.MAX_SAFE_INTEGER,
      descriptors,
    );
  }
  return descriptors;
}

export async function loadPageDescriptors(
  documents: DocumentStore,
  generationId: string,
  view: ViewMode,
  section: MaterializedSection,
  root: DirectoryRoot,
  after: string | null,
  limit: number,
): Promise<Readonly<{ descriptors: readonly ShardDescriptor[]; hasMore: boolean }>> {
  const descriptors: ShardDescriptor[] = [];
  await collectDescriptors(
    documents,
    generationId,
    view,
    section,
    root,
    after,
    limit + 1,
    descriptors,
  );
  return { descriptors: descriptors.slice(0, limit), hasMore: descriptors.length > limit };
}

export async function loadExactDescriptors(
  documents: DocumentStore,
  generationId: string,
  view: ViewMode,
  section: MaterializedSection,
  identities: readonly string[],
  root: DirectoryRoot,
): Promise<readonly ShardDescriptor[]> {
  const descriptors = await Promise.all(
    identities.map((identity) =>
      findDescriptor(documents, generationId, view, section, root, identity),
    ),
  );
  return descriptors.filter((descriptor): descriptor is ShardDescriptor => descriptor !== null);
}

async function collectDescriptors(
  documents: DocumentStore,
  generationId: string,
  view: ViewMode,
  section: MaterializedSection,
  reference: DirectoryNodeReference,
  after: string | null,
  limit: number,
  output: ShardDescriptor[],
): Promise<void> {
  if (
    output.length >= limit ||
    reference.count === 0 ||
    (after !== null &&
      reference.maxIdentity !== null &&
      stableStringCompare(reference.maxIdentity, after) <= 0)
  ) {
    return;
  }
  const node = await loadDirectoryNode(documents, generationId, view, section, reference);
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
    await collectDescriptors(documents, generationId, view, section, child, after, limit, output);
    if (output.length >= limit) {
      return;
    }
  }
}

async function findDescriptor(
  documents: DocumentStore,
  generationId: string,
  view: ViewMode,
  section: MaterializedSection,
  reference: DirectoryNodeReference,
  identity: string,
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
  const node = await loadDirectoryNode(documents, generationId, view, section, reference);
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
  return child ? findDescriptor(documents, generationId, view, section, child, identity) : null;
}

async function loadDirectoryNode(
  documents: DocumentStore,
  generationId: string,
  view: ViewMode,
  section: MaterializedSection,
  reference: DirectoryNodeReference,
): Promise<StoredDirectoryNode> {
  const stored = await documents.load(reference.documentId);
  if (!stored) {
    throw new Error("Published Projection directory is unavailable");
  }
  return parseDirectoryNode(generationId, view, section, reference, stored);
}

function parseDirectoryNode(
  generationId: string,
  view: ViewMode,
  section: MaterializedSection,
  reference: DirectoryNodeReference,
  stored: LoadedDocumentBytes,
): StoredDirectoryNode {
  if (!stored.snapshot || stored.updates.length > 0) {
    throw new Error("Published Projection directory is corrupt");
  }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(stored.snapshot));
  if (!isStoredDirectoryNode(parsed, generationId, reference, view, section)) {
    throw new Error("Published Projection directory is corrupt");
  }
  return parsed;
}

export async function deleteGenerationDocuments(
  documents: DocumentStore,
  generationId: string,
): Promise<void> {
  for (const prefix of [shardPrefix(generationId), directoryPrefix(generationId)]) {
    for (const id of await documents.listIds({ prefix })) {
      await documents.delete(id);
    }
  }
  await documents.delete(headerDocumentId(generationId));
  await documents.delete(planCacheDocumentId(generationId));
}

export async function deleteOrphanMaterializedDocuments(
  documents: DocumentStore,
  retained: ReadonlySet<string>,
): Promise<void> {
  for (const root of [
    "materialized-generation/shard/",
    "materialized-generation/directory/",
    "materialized-generation/plan-cache/",
  ]) {
    for (const id of await documents.listIds({ prefix: root })) {
      const generationId = id.slice(root.length).split("/")[0];
      if (generationId && !retained.has(generationId)) {
        await documents.delete(id);
      }
    }
  }
}
