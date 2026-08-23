import {
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
  type AuthoredAction,
  type ProjectionPerspective,
} from "../../../domain/fact/index.js";
import type { ProjectionSnapshotReader } from "../projection/index.js";
import type { GenerationReadScope } from "./read-scope.js";

export async function includeLifecycleScope(
  store: ProjectionSnapshotReader,
  generationId: string,
  perspective: ProjectionPerspective,
  actions: readonly AuthoredAction[],
  scope: GenerationReadScope,
): Promise<void> {
  const nodeIds = actions.flatMap((authoredAction) =>
    authoredAction.kind === "node-trash" || authoredAction.kind === "node-restore" ? [authoredAction.nodeId] : [],
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
