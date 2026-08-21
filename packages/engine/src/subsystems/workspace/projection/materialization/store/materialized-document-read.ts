import type { DocumentStore } from "../../../../persistence/index.js";
import { MaterializedGenerationCorruptError, MaterializedGenerationUnavailableError } from "./errors.js";

export async function loadMaterializedSnapshot(documents: DocumentStore, id: string): Promise<Uint8Array> {
  const stored = await documents.load(id);
  if (!stored) {
    throw new MaterializedGenerationUnavailableError("Published Projection Generation is unavailable");
  }
  if (!stored.snapshot || stored.updates.length > 0) {
    throw new MaterializedGenerationCorruptError("Published Projection Generation is corrupt");
  }
  return stored.snapshot;
}
