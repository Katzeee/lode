import type { DocumentStore } from "../../../../persistence/index.js";
import type { BoundedShardCache } from "./bounded-shard-cache.js";
import type { MaterializedDatasetCatalog, MaterializedDatasetEntry } from "./materialized-dataset.js";
import { cleanupMaterializedGenerations } from "./materialized-cleanup.js";
import { encodeMaterialized, headerDocumentId } from "./materialized-generation-format.js";
import { writeDirectoryNodes, writeMaterializedEntry } from "./materialized-directory.js";
import { materialize } from "./materialize-generation.js";

export async function commitMaterializedPublication<Identity extends Readonly<{ generationId: string }>>(
  documents: DocumentStore,
  identity: Identity,
  entries: readonly MaterializedDatasetEntry[],
  catalog: MaterializedDatasetCatalog<Identity>,
  shardCache: BoundedShardCache,
  capacity: number,
): Promise<void> {
  const materialized = materialize(identity, entries, catalog);
  for (const shard of materialized.shards) {
    await writeMaterializedEntry(documents, identity.generationId, shard);
  }
  await writeDirectoryNodes(documents, materialized.directoryNodes);
  await documents.writeSnapshot(headerDocumentId(identity.generationId), encodeMaterialized(materialized.header));

  shardCache.reset();
  for (const shard of materialized.shards.slice(0, capacity)) {
    shardCache.set(shard.descriptor.key, identity.generationId, shard.value);
  }
  try {
    await cleanupMaterializedGenerations(documents, identity.generationId);
  } catch {
    // Cleanup never participates in publication and a later publication retries it.
  }
}
