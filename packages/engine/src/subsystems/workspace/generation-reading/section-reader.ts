import type { ProjectionPerspective } from "../../../domain/fact/index.js";
import type { ProjectionSliceName, ProjectionSliceValue, ProjectionSnapshotReader } from "../projection/index.js";

export async function readSection<Section extends ProjectionSliceName>(
  store: ProjectionSnapshotReader,
  generationId: string,
  perspective: ProjectionPerspective,
  section: Section,
  identities: readonly string[],
): Promise<Record<string, ProjectionSliceValue<Section>>> {
  const batch = await store.read(generationId, perspective, section, [...new Set(identities)]);
  return Object.fromEntries(batch.entries.map((entry) => [entry.identity, entry.value]));
}
