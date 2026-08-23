import { addFieldActionRelations } from "./field-action-relations.js";
import { addInlineReferenceActionRelations, addTextActionRelations } from "./content-action-relations.js";
import {
  addAnchorRelations,
  addChildrenRelation,
  addSupertagRelation,
  createActionRelationCollection,
  finishActionRelationCollection,
  type MutableActionRelations,
  type ActionRelations,
} from "./action-relation-collection.js";
import { addTemplateActionRelations } from "./template-action-relations.js";
import { addSupertagActionRelations } from "./supertag-action-relations.js";
import type { NodeAction, PlacementAction, SearchExpressionAction, ViewAction } from "./action-family.js";
import type { AuthoredAction, SequenceAnchor } from "./types.js";
import type { FieldConfigurationSetAction } from "./field-definition-config-types.js";

export function actionRelations(action: AuthoredAction): ActionRelations {
  const relations = createActionRelationCollection();
  addActionRelations(relations, action);
  return finishActionRelationCollection(relations);
}

function addActionRelations(relations: MutableActionRelations, action: AuthoredAction): void {
  switch (action.kind) {
    case "workspace-bootstrap":
      relations.nodeIds.add(action.workspaceNodeId);
      break;
    case "node-create":
    case "node-trash":
    case "node-restore":
    case "original-promote":
      addNodeActionRelations(relations, action);
      break;
    case "placement-create":
    case "placement-remove":
    case "placement-move":
      addPlacementActionRelations(relations, action);
      break;
    case "supertag-application-add":
    case "supertag-membership-remove":
    case "supertag-extension-add":
    case "supertag-extension-remove":
    case "template-member-add":
    case "template-member-remove":
    case "template-field-add":
    case "template-field-remove":
    case "template-field-restore":
    case "template-field-visibility-set":
    case "template-field-static-default-set":
    case "optional-field-contribution-add":
    case "optional-field-contribution-remove":
      addSupertagActionRelations(relations, action);
      break;
    case "template-node-detach":
      addTemplateActionRelations(relations, action);
      break;
    case "field-materialize":
    case "field-value-remove":
    case "materialized-field-clear":
      addFieldActionRelations(relations, action);
      break;
    case "field-configuration-set":
      addFieldConfigurationSetActionRelations(relations, action);
      break;
    case "field-definition-make-discoverable":
      addFieldDefinition(relations, action.fieldDefinitionId);
      break;
    case "field-definition-return-to-template-field":
      addFieldDefinition(relations, action.fieldDefinitionId);
      relations.actionIds.add(action.templateFieldId);
      break;
    case "rich-text-splice":
    case "rich-text-mark":
      addTextActionRelations(relations, action);
      break;
    case "inline-reference-create":
    case "inline-reference-remove":
    case "inline-alias-attach":
    case "inline-alias-detach":
      addInlineReferenceActionRelations(relations, action);
      break;
    case "search-expression-add":
    case "search-expression-configure":
    case "search-expression-move":
    case "search-expression-remove":
    case "search-expression-restore":
      addSearchActionRelations(relations, action);
      break;
    case "shared-default-view-add":
    case "shared-default-view-remove":
    case "shared-default-view-restore":
    case "view-mode-set":
    case "view-column-add":
    case "view-column-remove":
    case "view-column-move":
    case "view-sort-add":
    case "view-sort-configure":
    case "view-sort-remove":
    case "view-sort-restore":
    case "view-group-add":
    case "view-group-remove":
    case "view-filter-add":
    case "view-filter-remove":
    case "view-filter-restore":
      addViewActionRelations(relations, action);
      break;
    default:
      action satisfies never;
      throw new Error(`Unhandled action: ${JSON.stringify(action)}`);
  }
}

function addFieldConfigurationSetActionRelations(
  relations: MutableActionRelations,
  action: FieldConfigurationSetAction,
): void {
  addFieldDefinition(relations, action.fieldDefinitionId);
  const configuration = action.configuration;
  if (configuration.kind === "datatype") {
    relations.nodeIds.add(configuration.datatypeNodeId);
    if (configuration.optionsSupertagId !== undefined) {
      addSupertagRelation(relations, configuration.optionsSupertagId);
    }
  } else if (configuration.kind === "cardinality") {
    relations.nodeIds.add(configuration.cardinalityNodeId);
  } else if (configuration.kind === "optionality") {
    relations.nodeIds.add(configuration.optionalityNodeId);
  } else {
    addFieldDefinition(relations, configuration.expression.sourceFieldDefinitionId);
  }
}

function addViewActionRelations(relations: MutableActionRelations, action: ViewAction): void {
  if (action.kind === "shared-default-view-add" || action.kind === "shared-default-view-remove") {
    relations.nodeIds.add(action.hostNodeId);
    if (action.kind === "shared-default-view-add") {
      addAnchorRelations(relations, action.anchor);
    }
    return;
  }
  if (action.kind === "shared-default-view-restore" || action.kind === "view-mode-set") {
    relations.actionIds.add(action.viewId);
  } else if (action.kind === "view-column-move") {
    relations.actionIds.add(action.columnId);
    addAnchorRelations(relations, action.anchor);
  } else if (action.kind === "view-sort-configure" || action.kind === "view-sort-restore") {
    relations.actionIds.add(action.sortId);
  } else if (action.kind === "view-filter-restore") {
    relations.actionIds.add(action.filterId);
  } else {
    relations.actionIds.add(action.viewId);
    if (action.kind === "view-column-add") {
      addAnchorRelations(relations, action.anchor);
    }
  }
  if (
    action.kind === "view-column-add" ||
    action.kind === "view-column-remove" ||
    action.kind === "view-sort-add" ||
    action.kind === "view-sort-configure" ||
    action.kind === "view-group-add"
  ) {
    addFieldDefinition(relations, action.fieldDefinitionId);
  }
}

function addSearchActionRelations(relations: MutableActionRelations, action: SearchExpressionAction): void {
  if (action.kind !== "search-expression-add") {
    relations.actionIds.add(action.expressionId);
    if (action.kind === "search-expression-move" && action.parentExpressionId !== null) {
      relations.actionIds.add(action.parentExpressionId);
    }
    if (action.kind !== "search-expression-configure") {
      return;
    }
  } else {
    relations.nodeIds.add(action.expressionHostId);
    if (action.parentExpressionId !== null) {
      relations.actionIds.add(action.parentExpressionId);
    }
    addAnchorRelations(relations, action.anchor);
  }
  const clause =
    action.kind === "search-expression-add" || action.kind === "search-expression-configure" ? action.clause : null;
  if (!clause) {
    return;
  }
  if (clause.kind === "supertag") {
    addSupertagRelation(relations, clause.supertagId);
  } else if (clause.kind === "field-defined" || clause.kind === "field-value" || clause.kind === "date-compare") {
    relations.nodeIds.add(clause.fieldDefinitionId);
    if (clause.kind === "field-value" && clause.value.kind === "node") {
      relations.nodeIds.add(clause.value.nodeId);
    }
  } else if ((clause.kind === "descendant-of" || clause.kind === "child-of") && clause.target.kind === "node") {
    relations.nodeIds.add(clause.target.nodeId);
  } else if (clause.kind === "links-to") {
    relations.nodeIds.add(clause.targetNodeId);
  }
}

function addNodeActionRelations(relations: MutableActionRelations, action: NodeAction): void {
  if (action.kind === "workspace-bootstrap") {
    relations.nodeIds.add(action.workspaceNodeId);
    return;
  }
  relations.nodeIds.add(action.nodeId);
  if (action.kind === "node-create") {
    addChildrenRelation(relations, action.ownerNodeId);
    if (action.originalPlacement !== null) {
      relations.occurrenceIds.add(action.originalPlacement.placementId);
      addAnchorRelations(relations, action.originalPlacement.anchor);
    }
  } else if (action.kind === "node-restore") {
    relations.occurrenceIds.add(action.placementId);
    addPlacement(relations, action.parentNodeId, action.anchor);
  } else if (action.kind === "original-promote") {
    relations.occurrenceIds.add(action.placementId);
  }
}

function addPlacementActionRelations(relations: MutableActionRelations, action: PlacementAction): void {
  relations.occurrenceIds.add(action.placementId);
  if (action.kind === "placement-create") {
    relations.nodeIds.add(action.nodeId);
    addPlacement(relations, action.parentNodeId, action.anchor);
  } else if (action.kind === "placement-move") {
    addPlacement(relations, action.parentNodeId, action.anchor);
  }
}

function addPlacement(relations: MutableActionRelations, parentNodeId: string, anchor: SequenceAnchor): void {
  addChildrenRelation(relations, parentNodeId);
  addAnchorRelations(relations, anchor);
}

function addFieldDefinition(relations: MutableActionRelations, fieldDefinitionId: string): void {
  relations.nodeIds.add(fieldDefinitionId);
  relations.fieldDefinitionIds.add(fieldDefinitionId);
}
