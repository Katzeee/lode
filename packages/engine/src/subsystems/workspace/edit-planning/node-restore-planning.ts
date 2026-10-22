import type { EditAction } from "../../../domain/edit/index.js";
import { materializedFieldNodeId, type GraphAction } from "../../../domain/fact/index.js";
import type { InterpretedProjection } from "../../../domain/reconcile/index.js";
import { requireAuthoredActionBatch, type AuthoredActionBatch } from "./action-batch.js";
import { materializedFieldFor, requireActiveNode } from "./projection-guards.js";

export function prepareNodeRestore(
  edit: Extract<EditAction, { kind: "node-restore" }>,
  available: InterpretedProjection,
): AuthoredActionBatch {
  const actions: GraphAction[] = [];
  const destination = edit.destination;
  let parentNodeId: string;
  if (destination.kind === "node") {
    parentNodeId = destination.nodeId;
  } else {
    requireActiveNode(destination.ownerNodeId, available, "Field owner");
    const field = materializedFieldFor(available, destination.ownerNodeId, destination.fieldDefinitionId);
    parentNodeId =
      field?.fieldNodeId ?? materializedFieldNodeId(destination.ownerNodeId, destination.fieldDefinitionId);
    if (field === undefined) {
      actions.push({
        kind: "field-materialize",
        ownerNodeId: destination.ownerNodeId,
        fieldDefinitionId: destination.fieldDefinitionId,
      });
    }
  }
  actions.push({
    kind: "node-restore",
    nodeId: edit.nodeId,
    placementId: edit.occurrenceId,
    parentNodeId,
    anchor: edit.anchor,
  });
  return requireAuthoredActionBatch(actions);
}
