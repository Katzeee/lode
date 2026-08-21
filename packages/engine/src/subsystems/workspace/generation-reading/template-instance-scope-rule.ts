import type { ProjectionPerspective } from "../../../domain/fact/index.js";
import type { Projection } from "../../../domain/reconcile/index.js";
import type { ProjectionSnapshotReader } from "../projection/index.js";
import { readIndex } from "./index-reader.js";
import type { GenerationReadScope } from "./read-scope.js";

type TemplateNodeInstance = Projection["templateNodeInstances"][number];

export async function includeTemplateInstanceScope(
  store: ProjectionSnapshotReader,
  generationId: string,
  perspective: ProjectionPerspective,
  scope: GenerationReadScope,
): Promise<Readonly<Record<string, TemplateNodeInstance>>> {
  const groups = await Promise.all([
    readIndex(store, generationId, perspective, "templateNodeInstancesByOwner", [...scope.nodes]),
    readIndex(store, generationId, perspective, "templateNodeInstancesByTemplate", [...scope.nodes]),
    readIndex(store, generationId, perspective, "templateNodeInstancesByNode", [...scope.nodes]),
    readIndex(store, generationId, perspective, "templateNodeInstancesByOccurrence", [...scope.occurrences]),
    readIndex(store, generationId, perspective, "templateNodeInstancesBySupertag", [...scope.supertags]),
  ]);
  const values = await readTemplateNodeInstances(store, generationId, perspective, [...new Set(groups.flat())]);
  for (const value of Object.values(values)) {
    scope.nodes.add(value.ownerNodeId);
    scope.nodes.add(value.templateNodeId);
    if (value.instanceNodeId !== null) {
      scope.nodes.add(value.instanceNodeId);
    }
    scope.occurrences.add(value.instanceOccurrenceId);
    value.sources.forEach((source) => {
      scope.supertags.add(source.supertagId);
      scope.supertags.add(source.appliedSupertagId);
    });
  }
  return values;
}

async function readTemplateNodeInstances(
  store: ProjectionSnapshotReader,
  generationId: string,
  perspective: ProjectionPerspective,
  identities: readonly string[],
): Promise<Record<string, TemplateNodeInstance>> {
  const batch = await store.read(generationId, perspective, "templateNodeInstances", identities);
  return Object.fromEntries(batch.entries.map((entry) => [entry.identity, entry.value]));
}
