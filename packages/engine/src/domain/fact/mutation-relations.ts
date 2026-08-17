import { addFieldMutationRelations } from "./field-mutation-relations.js";
import { addInlineReferenceMutationRelations, addTextMutationRelations } from "./content-mutation-relations.js";
import {
  addAnchorRelations,
  addChildrenRelation,
  addSupertagRelation,
  createMutationRelationCollection,
  finishMutationRelationCollection,
  type MutableMutationRelations,
  type MutationRelations,
} from "./mutation-relation-collection.js";
import { addTemplateMutationRelations } from "./template-mutation-relations.js";
import { addSupertagMutationRelations } from "./supertag-mutation-relations.js";
import type {
  FieldDefinitionConfigMutation,
  MetanodeMutation,
  NodeMutation,
  OccurrenceMutation,
  SearchExpressionMutation,
  ViewMutation,
} from "./mutation-family.js";
import type { Mutation, SequenceAnchor } from "./types.js";
import { visitSearchExpression } from "./search-expression-spec.js";

export function mutationRelations(mutation: Mutation): MutationRelations {
  const relations = createMutationRelationCollection();
  addMutationRelations(relations, mutation);
  return finishMutationRelationCollection(relations);
}

function addMutationRelations(relations: MutableMutationRelations, mutation: Mutation): void {
  switch (mutation.kind) {
    case "node-create":
    case "node-delete":
    case "node-restore":
    case "node-owner-set":
    case "intrinsic-node-type-declare":
      addNodeMutationRelations(relations, mutation);
      break;
    case "metanode-attach":
      addMetanodeMutationRelations(relations, mutation);
      break;
    case "occurrence-create":
    case "occurrence-delete":
    case "occurrence-restore":
    case "occurrence-move":
      addOccurrenceMutationRelations(relations, mutation);
      break;
    case "supertag-apply":
    case "supertag-remove":
    case "supertag-extension-add":
    case "supertag-extension-remove":
    case "supertag-template-node-add":
    case "supertag-template-node-remove":
    case "supertag-template-field-attach":
    case "supertag-template-field-existing-attach":
    case "supertag-template-field-detach":
    case "supertag-template-field-discoverability-set":
    case "supertag-template-field-visibility-configure":
    case "supertag-optional-field-contribution-attach":
    case "supertag-optional-field-contribution-detach":
      addSupertagMutationRelations(relations, mutation);
      break;
    case "template-node-detach":
      addTemplateMutationRelations(relations, mutation);
      break;
    case "field-materialize":
    case "field-value-delete":
    case "materialized-field-delete":
      addFieldMutationRelations(relations, mutation);
      break;
    case "field-datatype-configure":
      addFieldDefinitionConfigMutationRelations(relations, mutation);
      relations.nodeIds.add(mutation.datatypeNodeId);
      break;
    case "field-cardinality-configure":
      addFieldDefinitionConfigMutationRelations(relations, mutation);
      relations.nodeIds.add(mutation.cardinalityNodeId);
      break;
    case "field-optionality-configure":
      addFieldDefinitionConfigMutationRelations(relations, mutation);
      relations.nodeIds.add(mutation.optionalityNodeId);
      break;
    case "field-initialization-expression-configure":
      addFieldDefinitionConfigMutationRelations(relations, mutation);
      break;
    case "text-splice":
    case "text-mark":
      addTextMutationRelations(relations, mutation);
      break;
    case "inline-reference-create":
    case "inline-reference-delete":
    case "inline-reference-alias-attach":
    case "inline-reference-alias-detach":
      addInlineReferenceMutationRelations(relations, mutation);
      break;
    case "search-expression-attach":
    case "search-expression-detach":
      addSearchMutationRelations(relations, mutation);
      break;
    case "shared-default-view-definition-attach":
    case "shared-default-view-definition-detach":
    case "shared-default-view-definition-mode-set":
    case "shared-default-view-definition-sort-by-name-set":
    case "shared-default-view-definition-options-set":
      addViewMutationRelations(relations, mutation);
      break;
    default:
      mutation satisfies never;
      throw new Error(`Unhandled mutation: ${JSON.stringify(mutation)}`);
  }
}

function addFieldDefinitionConfigMutationRelations(
  relations: MutableMutationRelations,
  mutation: FieldDefinitionConfigMutation,
): void {
  addFieldDefinition(relations, mutation.fieldDefinitionId);
  relations.nodeIds.add(mutation.configurationNodeId);
  relations.occurrenceIds.add(mutation.configurationOccurrenceId);
  mutation.observedValueFactIds?.forEach((id) => relations.factIds.add(id));
  if (mutation.kind === "field-initialization-expression-configure") {
    relations.nodeIds.add(mutation.expression.expressionNodeId);
    relations.occurrenceIds.add(mutation.expression.expressionOccurrenceId);
    addFieldDefinition(relations, mutation.expression.sourceFieldDefinitionId);
    relations.occurrenceIds.add(mutation.expression.sourceFieldDefinitionOccurrenceId);
    relations.nodeIds.add(mutation.expression.contextNodeId);
    relations.occurrenceIds.add(mutation.expression.contextOccurrenceId);
  }
}

function addViewMutationRelations(relations: MutableMutationRelations, mutation: ViewMutation): void {
  relations.nodeIds.add(mutation.viewDefinitionNodeId);
  if (
    mutation.kind === "shared-default-view-definition-attach" ||
    mutation.kind === "shared-default-view-definition-detach"
  ) {
    relations.nodeIds.add(mutation.hostNodeId);
    relations.nodeIds.add(mutation.attachmentNodeId);
    relations.occurrenceIds.add(mutation.attachmentOccurrenceId);
    relations.occurrenceIds.add(mutation.relationDefinitionOccurrenceId);
    relations.occurrenceIds.add(mutation.viewDefinitionOccurrenceId);
    if (mutation.kind === "shared-default-view-definition-detach") {
      relations.nodeIds.add(mutation.detachedValueNodeId);
      relations.occurrenceIds.add(mutation.detachedValueOccurrenceId);
    }
  } else if (mutation.kind === "shared-default-view-definition-mode-set") {
    mutation.observedModeFactIds?.forEach((id) => relations.factIds.add(id));
  } else if (mutation.kind === "shared-default-view-definition-options-set") {
    relations.nodeIds.add(mutation.hostNodeId);
    for (const column of mutation.options.columns) {
      relations.nodeIds.add(column.fieldDefinitionId);
    }
    if (mutation.options.filter !== null) {
      visitSearchExpression(mutation.options.filter.expression, (expression) => {
        if (expression.kind === "supertag") {
          addSupertagRelation(relations, expression.supertagId);
        } else if (
          expression.kind === "field-defined" ||
          expression.kind === "field-value" ||
          expression.kind === "date-compare"
        ) {
          relations.nodeIds.add(expression.fieldDefinitionId);
          if (expression.kind === "field-value" && expression.value.kind === "node") {
            relations.nodeIds.add(expression.value.nodeId);
          }
        } else if (
          (expression.kind === "descendant-of" || expression.kind === "child-of") &&
          expression.target.kind === "node"
        ) {
          relations.nodeIds.add(expression.target.nodeId);
        } else if (expression.kind === "links-to") {
          relations.nodeIds.add(expression.targetNodeId);
        }
      });
    }
    if (mutation.options.sort !== null) {
      relations.nodeIds.add(mutation.options.sort.fieldDefinitionId);
    }
    if (mutation.options.group !== null) {
      relations.nodeIds.add(mutation.options.group.fieldDefinitionId);
    }
    mutation.observedOptionsFactIds?.forEach((id) => relations.factIds.add(id));
  } else {
    relations.nodeIds.add(mutation.hostNodeId);
    relations.nodeIds.add(mutation.sortOrderFieldNodeId);
    relations.nodeIds.add(mutation.sortFieldNodeId);
    relations.occurrenceIds.add(mutation.sortOrderFieldOccurrenceId);
    relations.occurrenceIds.add(mutation.sortFieldOccurrenceId);
    relations.occurrenceIds.add(mutation.nodeNameOccurrenceId);
    relations.occurrenceIds.add(mutation.ascendingOccurrenceId);
  }
}

function addSearchMutationRelations(relations: MutableMutationRelations, mutation: SearchExpressionMutation): void {
  relations.nodeIds.add(mutation.searchNodeId);
  relations.nodeIds.add(mutation.expressionNodeId);
  relations.occurrenceIds.add(mutation.expressionOccurrenceId);
  relations.occurrenceIds.add(mutation.definitionOccurrenceId);
  visitSearchExpression(mutation.expression, (expression) => {
    if (expression.kind === "supertag") {
      addSupertagRelation(relations, expression.supertagId);
    } else if (
      expression.kind === "field-defined" ||
      expression.kind === "field-value" ||
      expression.kind === "date-compare"
    ) {
      relations.nodeIds.add(expression.fieldDefinitionId);
      if (expression.kind === "field-value" && expression.value.kind === "node") {
        relations.nodeIds.add(expression.value.nodeId);
      }
    } else if (
      (expression.kind === "descendant-of" || expression.kind === "child-of") &&
      expression.target.kind === "node"
    ) {
      relations.nodeIds.add(expression.target.nodeId);
    } else if (expression.kind === "links-to") {
      relations.nodeIds.add(expression.targetNodeId);
    }
  });
}

function addMetanodeMutationRelations(relations: MutableMutationRelations, mutation: MetanodeMutation): void {
  relations.nodeIds.add(mutation.hostNodeId);
  relations.nodeIds.add(mutation.metanodeId);
  addChildrenRelation(relations, mutation.hostNodeId);
}

function addNodeMutationRelations(relations: MutableMutationRelations, mutation: NodeMutation): void {
  relations.nodeIds.add(mutation.nodeId);
  if (mutation.kind === "node-restore") {
    relations.factIds.add(mutation.deletionFactId);
  } else if (mutation.kind === "node-owner-set") {
    if (mutation.ownerNodeId !== null) {
      addChildrenRelation(relations, mutation.ownerNodeId);
    }
    if (mutation.previousOwnerNodeId !== undefined && mutation.previousOwnerNodeId !== null) {
      addChildrenRelation(relations, mutation.previousOwnerNodeId);
    }
  }
}

function addOccurrenceMutationRelations(relations: MutableMutationRelations, mutation: OccurrenceMutation): void {
  relations.occurrenceIds.add(mutation.occurrenceId);
  if (mutation.kind === "occurrence-create") {
    relations.nodeIds.add(mutation.nodeId);
    addPlacement(relations, mutation.parentNodeId, mutation.anchor);
  } else if (mutation.kind === "occurrence-delete") {
    addPreviousPlacement(relations, mutation.previousParentNodeId, mutation.previousAnchor);
  } else {
    if (mutation.kind === "occurrence-restore") {
      relations.factIds.add(mutation.deletionFactId);
    }
    addPlacement(relations, mutation.parentNodeId, mutation.anchor);
    if (mutation.kind === "occurrence-move") {
      addPreviousPlacement(relations, mutation.previousParentNodeId, mutation.previousAnchor);
    }
  }
}

function addPlacement(relations: MutableMutationRelations, parentNodeId: string, anchor: SequenceAnchor): void {
  addChildrenRelation(relations, parentNodeId);
  addAnchorRelations(relations, anchor);
}

function addFieldDefinition(relations: MutableMutationRelations, fieldDefinitionId: string): void {
  relations.nodeIds.add(fieldDefinitionId);
  relations.fieldDefinitionIds.add(fieldDefinitionId);
}

function addPreviousPlacement(
  relations: MutableMutationRelations,
  parentNodeId: string | undefined,
  anchor: SequenceAnchor | undefined,
): void {
  if (parentNodeId !== undefined) {
    addChildrenRelation(relations, parentNodeId);
  }
  addAnchorRelations(relations, anchor);
}
