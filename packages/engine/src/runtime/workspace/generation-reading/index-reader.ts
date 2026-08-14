import type { ViewMode } from "../../../domain/fact/index.js";
import type {
  ProjectionListIndexName,
  ProjectionSnapshotReader,
} from "../../materialization/index.js";

export async function readIndex(
  store: ProjectionSnapshotReader,
  generationId: string,
  view: ViewMode,
  section: ProjectionListIndexName,
  identities: readonly string[],
): Promise<readonly string[]> {
  const batch = await store.read(generationId, view, section, [...new Set(identities)]);
  return batch.entries.flatMap((entry) => entry.value);
}
