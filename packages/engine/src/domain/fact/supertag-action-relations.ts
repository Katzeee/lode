import { addAnchorRelations, addSupertagRelation, type MutableActionRelations } from "./action-relation-collection.js";
import type { SupertagAction } from "./action-family.js";

export function addSupertagActionRelations(relations: MutableActionRelations, action: SupertagAction): void {
  switch (action.kind) {
    case "supertag-application-add":
    case "supertag-membership-remove":
      relations.nodeIds.add(action.hostNodeId);
      addSupertagRelation(relations, action.supertagId);
      if (action.kind === "supertag-application-add") {
        addAnchorRelations(relations, action.anchor);
      }
      return;
    case "supertag-extension-add":
    case "supertag-extension-remove":
      addSupertagRelation(relations, action.supertagId);
      addSupertagRelation(relations, action.baseSupertagId);
      relations.instanceSupertagIds.add(action.supertagId);
      relations.instanceSupertagIds.add(action.baseSupertagId);
      if (action.kind === "supertag-extension-add") {
        addAnchorRelations(relations, action.anchor);
      }
      return;
    case "template-member-add":
    case "template-member-remove":
      addSupertagRelation(relations, action.supertagId);
      relations.nodeIds.add(action.templateNodeId);
      if (action.kind === "template-member-add") {
        addAnchorRelations(relations, action.anchor);
      }
      return;
    case "template-field-add":
      addSupertagRelation(relations, action.supertagId);
      addFieldDefinition(relations, action.fieldDefinition.fieldDefinitionId);
      addAnchorRelations(relations, action.anchor);
      return;
    case "template-field-remove":
    case "optional-field-contribution-remove":
      addSupertagRelation(relations, action.supertagId);
      addFieldDefinition(relations, action.fieldDefinitionId);
      return;
    case "optional-field-contribution-add":
      addSupertagRelation(relations, action.supertagId);
      addFieldDefinition(relations, action.fieldDefinitionId);
      addAnchorRelations(relations, action.anchor);
      return;
    case "template-field-restore":
    case "template-field-visibility-set":
    case "template-field-static-default-set":
      relations.actionIds.add(action.templateFieldId);
  }
}

function addFieldDefinition(relations: MutableActionRelations, fieldDefinitionId: string): void {
  relations.nodeIds.add(fieldDefinitionId);
  relations.fieldDefinitionIds.add(fieldDefinitionId);
}
