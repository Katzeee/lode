import type { ViewMode } from "../../domain/fact/index.js";
import type { ProjectionGenerationStore } from "./proposal-workspace-types.js";

export async function readIndex(
  store: ProjectionGenerationStore,
  generationId: string,
  view: ViewMode,
  section: Parameters<ProjectionGenerationStore["read"]>[2],
  identities: readonly string[],
): Promise<readonly string[]> {
  const batch = await store.read(generationId, view, section, [...new Set(identities)]);
  return batch.entries.flatMap((entry) =>
    Array.isArray(entry.value)
      ? entry.value.filter((identity): identity is string => typeof identity === "string")
      : [],
  );
}
