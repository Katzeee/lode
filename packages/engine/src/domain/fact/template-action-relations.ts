import { templateInstanceNodeId } from "./identity.js";
import { addAnchorRelations, type MutableActionRelations } from "./action-relation-collection.js";
import type { TemplateAction } from "./action-family.js";

export function addTemplateActionRelations(relations: MutableActionRelations, action: TemplateAction): void {
  relations.nodeIds.add(action.ownerNodeId);
  relations.nodeIds.add(action.templateNodeId);
  relations.nodeIds.add(action.instanceNodeId);
  relations.nodeIds.add(templateInstanceNodeId(action.ownerNodeId, action.templateNodeId));
  relations.occurrenceIds.add(action.instanceOccurrenceId);
  addAnchorRelations(relations, action.anchor);
}
