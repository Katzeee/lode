import { addAnchorRelations, type MutableMutationRelations } from "./mutation-relation-collection.js";
import type { InlineReferenceMutation, TextMutation } from "./mutation-family.js";

export function addTextMutationRelations(relations: MutableMutationRelations, mutation: TextMutation): void {
  relations.nodeIds.add(mutation.nodeId);
  const atomIds = mutation.kind === "text-splice" ? mutation.deleteAtomIds : mutation.atomIds;
  if (mutation.kind === "text-splice") {
    addAnchorRelations(relations, mutation.anchor);
  }
  atomIds.forEach((id) => relations.factIds.add(id.slice(0, id.lastIndexOf("#"))));
}

export function addInlineReferenceMutationRelations(
  relations: MutableMutationRelations,
  mutation: InlineReferenceMutation,
): void {
  relations.inlineReferenceIds.add(mutation.inlineReferenceId);
  if (mutation.kind === "inline-reference-create") {
    relations.nodeIds.add(mutation.hostNodeId);
    relations.nodeIds.add(mutation.targetNodeId);
  } else if (mutation.kind === "inline-reference-delete") {
    if (mutation.previousHostNodeId !== undefined) {
      relations.nodeIds.add(mutation.previousHostNodeId);
    }
    if (mutation.previousTargetNodeId !== undefined) {
      relations.nodeIds.add(mutation.previousTargetNodeId);
    }
  } else {
    relations.nodeIds.add(mutation.aliasNodeId);
  }
}
