import type { ViewMode } from "../../../domain/fact/index.js";
import type { Projection } from "../../../domain/reconcile/index.js";
import type { ProjectionSnapshotReader } from "../../materialization/index.js";
import { readIndex } from "./index-reader.js";
import type { GenerationReadScope } from "./read-plan.js";

type TemplateNodeInstance = Projection["templateNodeInstances"][number];

export async function includeTemplateInstanceScope(
  store: ProjectionSnapshotReader,
  generationId: string,
  view: ViewMode,
  scope: GenerationReadScope,
): Promise<Readonly<Record<string, TemplateNodeInstance>>> {
  const groups = await Promise.all([
    readIndex(store, generationId, view, "templateNodeInstancesByOwner", [...scope.nodes]),
    readIndex(store, generationId, view, "templateNodeInstancesByTemplate", [...scope.nodes]),
    readIndex(store, generationId, view, "templateNodeInstancesByNode", [...scope.nodes]),
    readIndex(store, generationId, view, "templateNodeInstancesByOccurrence", [
      ...scope.occurrences,
    ]),
    readIndex(store, generationId, view, "templateNodeInstancesBySchema", [...scope.schemas]),
  ]);
  const values = await readTemplateNodeInstances(store, generationId, view, [
    ...new Set(groups.flat()),
  ]);
  for (const value of Object.values(values)) {
    scope.nodes.add(value.ownerNodeId);
    scope.nodes.add(value.templateNodeId);
    if (value.instanceNodeId !== null) {
      scope.nodes.add(value.instanceNodeId);
    }
    scope.occurrences.add(value.instanceOccurrenceId);
    value.sources.forEach((source) => {
      scope.schemas.add(source.schemaId);
      scope.schemas.add(source.appliedSchemaId);
    });
  }
  return values;
}

async function readTemplateNodeInstances(
  store: ProjectionSnapshotReader,
  generationId: string,
  view: ViewMode,
  identities: readonly string[],
): Promise<Record<string, TemplateNodeInstance>> {
  const batch = await store.read(generationId, view, "templateNodeInstances", identities);
  return Object.fromEntries(batch.entries.map((entry) => [entry.identity, entry.value]));
}
