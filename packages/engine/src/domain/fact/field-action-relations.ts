import { fieldDefinitionEndpointOccurrenceId } from "./identity.js";
import { addChildrenRelation, type MutableActionRelations } from "./action-relation-collection.js";
import type { FieldAction } from "./action-family.js";

export function addFieldActionRelations(relations: MutableActionRelations, action: FieldAction): void {
  if (action.kind === "field-value-remove") {
    relations.occurrenceIds.add(action.valuePlacementId);
    return;
  }
  relations.nodeIds.add(action.ownerNodeId);
  addFieldDefinition(relations, action.fieldDefinitionId);
  if (action.kind === "materialized-field-clear") {
    return;
  }
  relations.nodeIds.add(action.fieldNodeId);
  relations.occurrenceIds.add(action.fieldOccurrenceId);
  relations.occurrenceIds.add(fieldDefinitionEndpointOccurrenceId(action.fieldOccurrenceId));
  addChildrenRelation(relations, action.fieldNodeId);
}

function addFieldDefinition(relations: MutableActionRelations, fieldDefinitionId: string): void {
  relations.nodeIds.add(fieldDefinitionId);
  relations.fieldDefinitionIds.add(fieldDefinitionId);
}
