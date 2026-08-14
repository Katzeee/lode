import type { ViewMode } from "../../../domain/fact/index.js";
import type {
  ProjectionSliceName,
  ProjectionSliceValue,
  ProjectionSnapshotReader,
} from "../../materialization/index.js";

export async function readSection<Section extends ProjectionSliceName>(
  store: ProjectionSnapshotReader,
  generationId: string,
  view: ViewMode,
  section: Section,
  identities: readonly string[],
): Promise<Record<string, ProjectionSliceValue<Section>>> {
  const batch = await store.read(generationId, view, section, [...new Set(identities)]);
  return Object.fromEntries(batch.entries.map((entry) => [entry.identity, entry.value]));
}
