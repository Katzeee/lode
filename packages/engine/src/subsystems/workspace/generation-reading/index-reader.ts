import type { ProjectionPerspective } from "../../../domain/fact/index.js";
import type { ProjectionListIndexName, ProjectionSnapshotReader } from "../projection/index.js";

export async function readIndex(
  store: ProjectionSnapshotReader,
  generationId: string,
  perspective: ProjectionPerspective,
  section: ProjectionListIndexName,
  identities: readonly string[],
): Promise<readonly string[]> {
  const batch = await store.read(generationId, perspective, section, [...new Set(identities)]);
  return batch.entries.flatMap((entry) => entry.value);
}
