import {
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
  type Mutation,
  type ProjectionPerspective,
} from "../../../domain/fact/index.js";
import type { ProjectionSnapshotReader } from "../projection/index.js";
import type { GenerationReadScope } from "./read-scope.js";

export async function includeLifecycleScope(
  store: ProjectionSnapshotReader,
  generationId: string,
  perspective: ProjectionPerspective,
  mutations: readonly Mutation[],
  scope: GenerationReadScope,
): Promise<void> {
  const nodeIds = mutations.flatMap((mutation) =>
    mutation.kind === "node-delete" || mutation.kind === "node-restore" ? [mutation.nodeId] : [],
  );
  const batch = await store.read(generationId, perspective, "nodes", nodeIds);
  for (const entry of batch.entries) {
    if (entry.value.intrinsicNodeType === SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE) {
      scope.supertags.add(entry.identity);
      scope.instanceSupertags.add(entry.identity);
    }
    if (entry.value.intrinsicNodeType === FIELD_DEFINITION_INTRINSIC_NODE_TYPE) {
      scope.fields.add(entry.identity);
    }
  }
}
