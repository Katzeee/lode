import type { DocumentStore } from "../../persistence/document-store.js";
import {
  MANIFEST_DOCUMENT_ID,
  MANIFEST_FORMAT,
  type GenerationManifest,
} from "./materialized-generation-format.js";
import { isManifest } from "./materialized-format-validation.js";

export async function loadMaterializedSnapshot(
  documents: DocumentStore,
  id: string,
): Promise<Uint8Array> {
  const stored = await documents.load(id);
  if (!stored?.snapshot || stored.updates.length > 0) {
    throw new Error("Published Projection Generation is unavailable");
  }
  return stored.snapshot;
}

export async function loadGenerationManifest(
  documents: DocumentStore,
): Promise<GenerationManifest> {
  const stored = await documents.load(MANIFEST_DOCUMENT_ID);
  if (!stored) {
    return { format: MANIFEST_FORMAT, generationIds: [] };
  }
  if (!stored.snapshot || stored.updates.length > 0) {
    throw new Error("Published Projection Generation manifest is corrupt");
  }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(stored.snapshot));
  if (!isManifest(parsed)) {
    throw new Error("Published Projection Generation manifest is corrupt");
  }
  return parsed;
}
