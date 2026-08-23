import { addAnchorRelations, type MutableActionRelations } from "./action-relation-collection.js";
import type { InlineReferenceAction, TextAction } from "./action-family.js";

export function addTextActionRelations(relations: MutableActionRelations, action: TextAction): void {
  relations.nodeIds.add(action.nodeId);
  const atomIds = action.kind === "rich-text-splice" ? action.deleteAtomIds : action.atomIds;
  if (action.kind === "rich-text-splice") {
    addAnchorRelations(relations, action.anchor);
  }
  atomIds.forEach((id) => relations.actionIds.add(id.slice(0, id.lastIndexOf("#"))));
}

export function addInlineReferenceActionRelations(
  relations: MutableActionRelations,
  action: InlineReferenceAction,
): void {
  relations.inlineReferenceIds.add(action.inlineReferenceId);
  if (action.kind === "inline-reference-create") {
    relations.nodeIds.add(action.hostNodeId);
    relations.nodeIds.add(action.targetNodeId);
  } else if (action.kind !== "inline-reference-remove") {
    relations.nodeIds.add(action.aliasNodeId);
  }
}
