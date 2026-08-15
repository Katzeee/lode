import type { DocumentStore } from "../../persistence/document-store.js";
import type { BoundedShardCache } from "./bounded-shard-cache.js";
import type { MaterializedDatasetCatalog, MaterializedDatasetEntry } from "./materialized-dataset.js";
import { cleanupMaterializedGenerations } from "./materialized-cleanup.js";
import { loadGenerationManifest } from "./materialized-document-read.js";
import {
  MANIFEST_DOCUMENT_ID,
  MANIFEST_FORMAT,
  encodeMaterialized,
  headerDocumentId,
  type GenerationManifest,
} from "./materialized-generation-format.js";
import { writeDirectoryNodes, writeMaterializedEntry } from "./materialized-directory.js";
import { materialize } from "./materialize-generation.js";

export async function commitMaterializedPublication<Identity extends Readonly<{ generationId: string }>>(
  documents: DocumentStore,
  identity: Identity,
  entries: readonly MaterializedDatasetEntry[],
  catalog: MaterializedDatasetCatalog<Identity>,
  shardCache: BoundedShardCache,
  capacity: number,
  pinned: ReadonlyMap<string, number>,
): Promise<void> {
  const previousManifest = await loadGenerationManifest(documents);
  try {
    await cleanupMaterializedGenerations(documents, previousManifest.generationIds, pinned);
  } catch {
    // A later successful publication repeats cleanup from the durable manifest.
  }
  const materialized = materialize(identity, entries, catalog);
  for (const shard of materialized.shards) {
    await writeMaterializedEntry(documents, identity.generationId, shard);
  }
  await writeDirectoryNodes(documents, materialized.directoryNodes);
  await documents.writeSnapshot(headerDocumentId(identity.generationId), encodeMaterialized(materialized.header));

  const generationIds = [
    ...previousManifest.generationIds.filter((generationId) => generationId !== identity.generationId),
    identity.generationId,
  ].slice(-2);
  await documents.writeSnapshot(
    MANIFEST_DOCUMENT_ID,
    encodeMaterialized({ format: MANIFEST_FORMAT, generationIds } satisfies GenerationManifest),
  );

  shardCache.reset();
  for (const shard of materialized.shards.slice(0, capacity)) {
    shardCache.set(shard.descriptor.key, identity.generationId, shard.value);
  }
  try {
    await cleanupMaterializedGenerations(documents, generationIds, pinned);
  } catch {
    // The manifest bounds the live set; a later publication retries orphan cleanup.
  }
}
