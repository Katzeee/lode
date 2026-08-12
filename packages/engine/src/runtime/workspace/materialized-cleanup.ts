import type { DocumentStore } from "../../persistence/document-store.js";
import {
  deleteGenerationDocuments,
  deleteOrphanMaterializedDocuments,
} from "./materialized-directory.js";

export async function cleanupMaterializedGenerations(
  documents: DocumentStore,
  retainedIds: readonly string[],
  pinned: ReadonlyMap<string, number>,
  scanOrphanShards = true,
): Promise<void> {
  const retained = new Set(retainedIds);
  const headerPrefix = "materialized-generation/header/";
  const headerIds = await documents.listIds({ prefix: headerPrefix });
  const storedIds = headerIds.map((id) => id.slice(headerPrefix.length));
  for (const generationId of storedIds.filter((id) => !retained.has(id) && !pinned.has(id))) {
    await deleteGenerationDocuments(documents, generationId);
  }
  if (pinned.size === 0 && scanOrphanShards) {
    await deleteOrphanMaterializedDocuments(documents, retained);
  }
}
