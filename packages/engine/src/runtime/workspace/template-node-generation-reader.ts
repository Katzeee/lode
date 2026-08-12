import type { ViewMode } from "../../domain/fact/index.js";
import type { Projection } from "../../domain/reconcile/index.js";
import { isTemplateNodeInstance, type MutationReadScope } from "./mutation-read-scope.js";
import type { ProjectionGenerationStore } from "./proposal-workspace-types.js";

export async function readTemplateNodeInstances(
  store: ProjectionGenerationStore,
  generationId: string,
  view: ViewMode,
  wanted: MutationReadScope,
): Promise<Readonly<Record<string, unknown>>> {
  const groups = await Promise.all([
    readIndex(store, generationId, view, "templateNodeInstancesByOwner", [...wanted.nodes]),
    readIndex(store, generationId, view, "templateNodeInstancesByTemplate", [...wanted.nodes]),
    readIndex(store, generationId, view, "templateNodeInstancesByNode", [...wanted.nodes]),
    readIndex(store, generationId, view, "templateNodeInstancesByOccurrence", [
      ...wanted.occurrences,
    ]),
    readIndex(store, generationId, view, "templateNodeInstancesBySchema", [...wanted.schemas]),
  ]);
  const values = await readSection(store, generationId, view, "templateNodeInstances", [
    ...new Set(groups.flat()),
  ]);
  addTemplateScope(values, wanted);
  return values;
}

export function templateNodeInstancesOf(
  values: Readonly<Record<string, unknown>>,
): Projection["templateNodeInstances"] {
  return Object.values(values).filter(isTemplateNodeInstance);
}

function addTemplateScope(
  values: Readonly<Record<string, unknown>>,
  wanted: MutationReadScope,
): void {
  for (const value of Object.values(values)) {
    if (!isTemplateNodeInstance(value)) {
      continue;
    }
    wanted.nodes.add(value.ownerNodeId);
    wanted.nodes.add(value.templateNodeId);
    if (value.instanceNodeId !== null) {
      wanted.nodes.add(value.instanceNodeId);
    }
    wanted.occurrences.add(value.instanceOccurrenceId);
    value.sources.forEach((source) => {
      wanted.schemas.add(source.schemaId);
      wanted.schemas.add(source.appliedSchemaId);
    });
  }
}

async function readIndex(
  store: ProjectionGenerationStore,
  generationId: string,
  view: ViewMode,
  section: Parameters<ProjectionGenerationStore["read"]>[2],
  identities: readonly string[],
): Promise<readonly string[]> {
  const values = await readSection(store, generationId, view, section, identities);
  return Object.values(values).flatMap((value) =>
    Array.isArray(value)
      ? value.filter((identity): identity is string => typeof identity === "string")
      : [],
  );
}

async function readSection(
  store: ProjectionGenerationStore,
  generationId: string,
  view: ViewMode,
  section: Parameters<ProjectionGenerationStore["read"]>[2],
  identities: readonly string[],
): Promise<Record<string, unknown>> {
  const batch = await store.read(generationId, view, section, [...new Set(identities)]);
  return Object.fromEntries(batch.entries.map((entry) => [entry.identity, entry.value]));
}
