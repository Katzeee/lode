import type { ViewMode } from "../../domain/fact/index.js";
import type { ProjectionGenerationStore } from "./proposal-workspace-types.js";
import { isProjectedOccurrence } from "./mutation-read-scope.js";

export async function includeOccurrenceAncestors(
  store: ProjectionGenerationStore,
  generationId: string,
  view: ViewMode,
  initial: Record<string, unknown>,
): Promise<Record<string, unknown>> {
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

function parentIds(values: readonly unknown[]): string[] {
  return values.flatMap((value) => (isProjectedOccurrence(value) ? [value.parentNodeId] : []));
}
