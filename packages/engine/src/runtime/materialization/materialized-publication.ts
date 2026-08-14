import type { ProjectionGeneration } from "../../domain/reconcile/index.js";
import type { ReviewReadModel } from "../../domain/review/index.js";
import type { DocumentStore } from "../../persistence/document-store.js";
import type { BoundedShardCache } from "./bounded-shard-cache.js";
import { cleanupMaterializedGenerations } from "./materialized-cleanup.js";
import { loadGenerationManifest } from "./materialized-document-read.js";
import {
  MANIFEST_DOCUMENT_ID,
  MANIFEST_FORMAT,
  encodeMaterialized,
  headerDocumentId,
  planCacheDocumentId,
  type GenerationManifest,
} from "./materialized-generation-format.js";
import { writeDirectoryNodes, writeMaterializedEntry } from "./materialized-directory.js";
import { materialize } from "./materialize-generation.js";

export async function commitMaterializedPublication(
  documents: DocumentStore,
  generation: ProjectionGeneration,
  review: ReviewReadModel,
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
  const materialized = materialize(generation, review);
  for (const shard of materialized.shards) {
    await writeMaterializedEntry(documents, generation.identity.generationId, shard);
  }
  await writeDirectoryNodes(documents, materialized.directoryNodes);
  await documents.writeSnapshot(
    planCacheDocumentId(generation.identity.generationId),
    encodeMaterialized(materialized.planCaches),
  );
  await documents.writeSnapshot(
    headerDocumentId(generation.identity.generationId),
    encodeMaterialized(materialized.header),
  );

  const generationIds = [
    ...previousManifest.generationIds.filter(
      (generationId) => generationId !== generation.identity.generationId,
    ),
    generation.identity.generationId,
  ].slice(-2);
  await documents.writeSnapshot(
    MANIFEST_DOCUMENT_ID,
    encodeMaterialized({ format: MANIFEST_FORMAT, generationIds } satisfies GenerationManifest),
  );

  shardCache.reset();
  for (const shard of materialized.shards.slice(0, capacity)) {
    shardCache.set(shard.descriptor.key, generation.identity.generationId, shard.value);
  }
  try {
    await cleanupMaterializedGenerations(documents, generationIds, pinned);
  } catch {
    // The manifest bounds the live set; a later publication retries orphan cleanup.
  }
}
