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
  const nodeIds = mutations.flatMap((mutation) =>
    mutation.kind === "node-delete" || mutation.kind === "node-restore" ? [mutation.nodeId] : [],
  );
  const batch = await store.read(generationId, view, "nodeStatuses", nodeIds);
  for (const entry of batch.entries) {
    if (!isNodeStatus(entry.value)) {
      continue;
    }
    if (entry.value.roles.includes("schema")) {
      wanted.schemas.add(entry.identity);
      wanted.instanceSchemas.add(entry.identity);
    }
    if (entry.value.roles.includes("field")) {
      wanted.fields.add(entry.identity);
    }
  }
}

function isNodeStatus(
  value: unknown,
): value is Readonly<{ roles: readonly ("schema" | "field")[] }> {
  return (
    typeof value === "object" &&
    value !== null &&
    "roles" in value &&
    Array.isArray(value.roles) &&
    value.roles.every((role) => role === "schema" || role === "field")
  );
}
