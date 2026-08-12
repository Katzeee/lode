import type { Mutation, ViewMode } from "../../domain/fact/index.js";
import type { MutationReadScope } from "./mutation-read-scope.js";
import type { ProjectionGenerationStore } from "./proposal-workspace-types.js";

export async function expandLifecycleReadScope(
  store: ProjectionGenerationStore,
  generationId: string,
  view: ViewMode,
  mutations: readonly Mutation[],
  wanted: MutationReadScope,
): Promise<void> {
  const definitionIds = mutations.flatMap((mutation) =>
    mutation.kind === "node-delete" || mutation.kind === "node-restore" ? [mutation.nodeId] : [],
  );
  const batch = await store.read(generationId, view, "definitionStatuses", definitionIds);
  for (const entry of batch.entries) {
    if (!isDefinitionStatus(entry.value)) {
      continue;
    }
    if (entry.value.kinds.includes("schema")) {
      wanted.schemas.add(entry.identity);
      wanted.instanceSchemas.add(entry.identity);
    }
    if (entry.value.kinds.includes("field")) {
      wanted.fields.add(entry.identity);
    }
  }
}

function isDefinitionStatus(
  value: unknown,
): value is Readonly<{ kinds: readonly ("schema" | "field")[] }> {
  return (
    typeof value === "object" &&
    value !== null &&
    "kinds" in value &&
    Array.isArray(value.kinds) &&
    value.kinds.every((kind) => kind === "schema" || kind === "field")
  );
}
