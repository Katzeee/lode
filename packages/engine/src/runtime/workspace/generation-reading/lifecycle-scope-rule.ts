import {
  FIELD_DEFINITION_NODE_TYPE,
  SCHEMA_NODE_TYPE,
  type Mutation,
  type ViewMode,
} from "../../../domain/fact/index.js";
import type { ProjectionSnapshotReader } from "../../materialization/index.js";
import type { GenerationReadScope } from "./read-plan.js";

export async function includeLifecycleScope(
  store: ProjectionSnapshotReader,
  generationId: string,
  view: ViewMode,
  mutations: readonly Mutation[],
  scope: GenerationReadScope,
): Promise<void> {
  const nodeIds = mutations.flatMap((mutation) =>
    mutation.kind === "node-delete" || mutation.kind === "node-restore" ? [mutation.nodeId] : [],
  );
  const batch = await store.read(generationId, view, "nodeStatuses", nodeIds);
  for (const entry of batch.entries) {
    if (entry.value.nodeType === SCHEMA_NODE_TYPE) {
      scope.schemas.add(entry.identity);
      scope.instanceSchemas.add(entry.identity);
    }
    if (entry.value.nodeType === FIELD_DEFINITION_NODE_TYPE) {
      scope.fields.add(entry.identity);
    }
  }
}
