import { fieldDefinitionEndpointOccurrenceId } from "./identity.js";
import {
  addAnchorRelations,
  addChildrenRelation,
  type MutableMutationRelations,
} from "./mutation-relation-collection.js";
import type { FieldMutation } from "./mutation-family.js";

export function addFieldMutationRelations(relations: MutableMutationRelations, mutation: FieldMutation): void {
  relations.nodeIds.add(mutation.ownerNodeId);
  addFieldDefinition(relations, mutation.fieldDefinitionId);
  if (mutation.kind === "field-value-delete") {
    relations.occurrenceIds.add(mutation.valueOccurrenceId);
    addPreviousPlacement(relations, mutation.previousParentNodeId, mutation.previousAnchor);
    return;
  }
  relations.nodeIds.add(mutation.fieldNodeId);
  relations.occurrenceIds.add(mutation.fieldOccurrenceId);
  if (mutation.kind === "field-materialize") {
    relations.occurrenceIds.add(fieldDefinitionEndpointOccurrenceId(mutation.fieldOccurrenceId));
  }
  addChildrenRelation(relations, mutation.fieldNodeId);
  if (mutation.kind === "materialized-field-delete") {
    addPreviousPlacement(relations, mutation.previousParentNodeId, mutation.previousAnchor);
  }
}

function addFieldDefinition(relations: MutableMutationRelations, fieldDefinitionId: string): void {
  relations.nodeIds.add(fieldDefinitionId);
  relations.fieldDefinitionIds.add(fieldDefinitionId);
}

function addPreviousPlacement(
  relations: MutableMutationRelations,
  parentNodeId: string | undefined,
  anchor: Parameters<typeof addAnchorRelations>[1],
): void {
  if (parentNodeId !== undefined) {
    addChildrenRelation(relations, parentNodeId);
  }
  addAnchorRelations(relations, anchor);
}
