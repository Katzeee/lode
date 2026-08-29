import type { EditAction } from "../../../domain/edit/index.js";
import { locateInlineReference, type InterpretedProjection } from "../../../domain/reconcile/index.js";
import { authoredActionBatch, type AuthoredActionBatch } from "./action-batch.js";

export function prepareInlineReferenceAliasCreation(
  edit: Extract<EditAction, { kind: "inline-reference-alias-create" }>,
  available: InterpretedProjection,
): AuthoredActionBatch {
  const location = locateInlineReference(available.nodes, edit.inlineReferenceId);
  if (!location || location.hostNodeId !== edit.hostNodeId) {
    throw new Error("Inline Reference is absent from the requested host Node");
  }
  if (location.reference.aliasNodeId !== null) {
    throw new Error("Inline Reference already has an Alias");
  }
  if (available.nodes[edit.aliasNodeId] !== undefined) {
    throw new Error("Inline Alias Node identity already exists");
  }
  return authoredActionBatch([
    {
      kind: "node-create",
      nodeId: edit.aliasNodeId,
      ownerNodeId: edit.hostNodeId,
      originalPlacement: null,
      ...(edit.seed === undefined ? {} : { seed: edit.seed }),
    },
    {
      kind: "inline-alias-attach",
      inlineReferenceId: edit.inlineReferenceId,
      aliasNodeId: edit.aliasNodeId,
    },
  ]);
}
