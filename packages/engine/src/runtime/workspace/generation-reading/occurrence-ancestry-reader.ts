import type { ViewMode } from "../../../domain/fact/index.js";
import type { ProjectedOccurrence } from "../../../domain/reconcile/index.js";
import type { ProjectionSnapshotReader } from "../../materialization/index.js";

export async function includeOccurrenceAncestors(
  store: ProjectionSnapshotReader,
  generationId: string,
  view: ViewMode,
  initial: Record<string, ProjectedOccurrence>,
): Promise<Record<string, ProjectedOccurrence>> {
  const occurrences = { ...initial };
  const visited = new Set(Object.keys(occurrences));
  let frontier = parentIds(Object.values(occurrences));
  const maximumDepth = 4_096;
  for (let depth = 0; frontier.length > 0; depth += 1) {
    if (depth >= maximumDepth) {
      throw new Error("Occurrence ancestry exceeds the state-dependent read bound");
    }
    const wanted = frontier.filter((identity) => !visited.has(identity));
    if (wanted.length === 0) {
      break;
    }
    wanted.forEach((identity) => visited.add(identity));
    const batch = await store.read(generationId, view, "occurrences", wanted);
    const parents = Object.fromEntries(batch.entries.map((entry) => [entry.identity, entry.value]));
    Object.assign(occurrences, parents);
    frontier = parentIds(Object.values(parents));
  }
  return occurrences;
}

function parentIds(values: readonly ProjectedOccurrence[]): string[] {
  return values.map((value) => value.parentNodeId);
}
