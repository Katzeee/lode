import type { DocumentStore } from "../../../../persistence/index.js";
import { deleteGenerationDocuments, deleteOrphanMaterializedDocuments } from "./materialized-directory.js";

export async function cleanupMaterializedGenerations(
  documents: DocumentStore,
  retainedGenerationId: string,
): Promise<void> {
  const retained = new Set([retainedGenerationId]);
  const headerPrefix = "materialized-generation/header/";
  const headerIds = await documents.listIds({ prefix: headerPrefix });
  const storedIds = headerIds.map((id) => id.slice(headerPrefix.length));
  for (const generationId of storedIds.filter((id) => !retained.has(id))) {
    await deleteGenerationDocuments(documents, generationId);
  }
  await deleteOrphanMaterializedDocuments(documents, retained);
}
