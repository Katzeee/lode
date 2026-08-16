import { templateInstanceNodeId } from "./identity.js";
import {
  addAnchorRelations,
  addChildrenRelation,
  addSupertagRelation,
  createMutationRelationCollection,
  finishMutationRelationCollection,
  type MutableMutationRelations,
  type MutationRelations,
} from "./mutation-relation-collection.js";
import type {
  FieldMutation,
  FieldDefinitionConfigMutation,
  InlineReferenceMutation,
  MetanodeMutation,
  NodeMutation,
  OccurrenceMutation,
  SupertagMutation,
  TemplateMutation,
  TextMutation,
  SearchClauseMutation,
  ViewMutation,
} from "./mutation-family.js";
import type { Mutation, SequenceAnchor } from "./types.js";

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
    case "node-type-declare":
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
    case "supertag-field-add":
    case "supertag-field-remove":
    case "supertag-field-configure":
    case "supertag-extension-add":
    case "supertag-extension-remove":
    case "supertag-template-node-add":
    case "supertag-template-node-remove":
      addSupertagMutationRelations(relations, mutation);
      break;
    case "template-node-detach":
      addTemplateMutationRelations(relations, mutation);
      break;
    case "field-materialize":
    case "field-value-delete":
    case "materialized-field-delete":
    case "field-initialize":
      addFieldMutationRelations(relations, mutation);
      break;
    case "field-datatype-configure":
    case "field-cardinality-configure":
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
    case "search-supertag-clause-attach":
    case "search-field-clause-attach":
      addSearchMutationRelations(relations, mutation);
      break;
    case "shared-default-view-definition-attach":
    case "shared-default-view-definition-mode-set":
      addViewMutationRelations(relations, mutation);
      break;
    default:
      assertNever(mutation);
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
    addFieldDefinition(relations, mutation.expression.sourceFieldDefinitionId);
  }
}

function addViewMutationRelations(relations: MutableMutationRelations, mutation: ViewMutation): void {
  relations.nodeIds.add(mutation.viewDefinitionNodeId);
  if (mutation.kind === "shared-default-view-definition-attach") {
    relations.nodeIds.add(mutation.hostNodeId);
    relations.occurrenceIds.add(mutation.viewDefinitionOccurrenceId);
  } else {
    mutation.observedModeFactIds?.forEach((id) => relations.factIds.add(id));
  }
}

function addSearchMutationRelations(relations: MutableMutationRelations, mutation: SearchClauseMutation): void {
  relations.nodeIds.add(mutation.searchNodeId);
  relations.nodeIds.add(mutation.clauseNodeId);
  relations.occurrenceIds.add(mutation.clauseOccurrenceId);
  if (mutation.kind === "search-supertag-clause-attach") {
    addSupertagRelation(relations, mutation.supertagId);
  } else {
    addFieldDefinition(relations, mutation.fieldDefinitionId);
  }
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
    addChildrenRelation(relations, mutation.ownerNodeId);
    if (mutation.previousOwnerNodeId !== undefined) {
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

function addSupertagMutationRelations(relations: MutableMutationRelations, mutation: SupertagMutation): void {
  addSupertagRelation(relations, mutation.supertagId);
  if (mutation.kind === "supertag-apply" || mutation.kind === "supertag-remove") {
    relations.nodeIds.add(mutation.nodeId);
    addRelationAnchor(relations, mutation);
    return;
  }
  if (mutation.kind === "supertag-extension-add" || mutation.kind === "supertag-extension-remove") {
    addSupertagRelation(relations, mutation.baseSupertagId);
    relations.instanceSupertagIds.add(mutation.supertagId);
    relations.instanceSupertagIds.add(mutation.baseSupertagId);
    addRelationAnchor(relations, mutation);
    return;
  }
  if (mutation.kind === "supertag-template-node-add" || mutation.kind === "supertag-template-node-remove") {
    relations.nodeIds.add(mutation.templateNodeId);
    relations.occurrenceIds.add(mutation.templateOccurrenceId);
    addRelationAnchor(relations, mutation);
    return;
  }
  addFieldDefinition(relations, mutation.fieldDefinitionId);
  relations.nodeIds.add(mutation.fieldNodeId);
  relations.instanceSupertagIds.add(mutation.supertagId);
  if (mutation.kind === "supertag-field-configure") {
    mutation.observedConfigFactIds?.forEach((id) => relations.factIds.add(id));
  } else {
    relations.occurrenceIds.add(mutation.fieldOccurrenceId);
    addRelationAnchor(relations, mutation);
  }
}

function addRelationAnchor(
  relations: MutableMutationRelations,
  mutation: Exclude<SupertagMutation, { kind: "supertag-field-configure" }>,
): void {
  if (
    mutation.kind === "supertag-apply" ||
    mutation.kind === "supertag-field-add" ||
    mutation.kind === "supertag-extension-add" ||
    mutation.kind === "supertag-template-node-add"
  ) {
    addAnchorRelations(relations, mutation.anchor);
  } else {
    addAnchorRelations(relations, mutation.previousAnchor);
  }
}

function addTemplateMutationRelations(relations: MutableMutationRelations, mutation: TemplateMutation): void {
  relations.nodeIds.add(mutation.ownerNodeId);
  relations.nodeIds.add(mutation.templateNodeId);
  relations.nodeIds.add(mutation.instanceNodeId);
  relations.nodeIds.add(templateInstanceNodeId(mutation.ownerNodeId, mutation.templateNodeId));
  relations.occurrenceIds.add(mutation.instanceOccurrenceId);
  addAnchorRelations(relations, mutation.anchor);
  mutation.sourceSupertagIds?.forEach((supertagId) => addSupertagRelation(relations, supertagId));
  mutation.sourceApplicationSupertagIds?.forEach((supertagId) => {
    addSupertagRelation(relations, supertagId);
    relations.instanceSupertagIds.add(supertagId);
  });
  mutation.sourceTemplateOccurrenceIds?.forEach((id) => relations.occurrenceIds.add(id));
}

function addFieldMutationRelations(relations: MutableMutationRelations, mutation: FieldMutation): void {
  relations.nodeIds.add(mutation.ownerNodeId);
  addFieldDefinition(relations, mutation.fieldDefinitionId);
  if (mutation.kind === "field-value-delete") {
    relations.occurrenceIds.add(mutation.valueOccurrenceId);
    addPreviousPlacement(relations, mutation.previousParentNodeId, mutation.previousAnchor);
    return;
  }
  relations.nodeIds.add(mutation.fieldNodeId);
  relations.occurrenceIds.add(mutation.fieldOccurrenceId);
  if (mutation.kind === "field-initialize") {
    addSupertagRelation(relations, mutation.supertagId);
    relations.instanceSupertagIds.add(mutation.supertagId);
    mutation.values.forEach((value) => {
      relations.nodeIds.add(value.nodeId);
      relations.occurrenceIds.add(value.occurrenceId);
    });
    mutation.observedInitializationFactIds?.forEach((id) => relations.factIds.add(id));
    return;
  }
  addChildrenRelation(relations, mutation.fieldNodeId);
  if (mutation.kind === "materialized-field-delete") {
    addPreviousPlacement(relations, mutation.previousParentNodeId, mutation.previousAnchor);
  }
}

function addTextMutationRelations(relations: MutableMutationRelations, mutation: TextMutation): void {
  relations.nodeIds.add(mutation.nodeId);
  if (mutation.kind === "text-splice") {
    addAnchorRelations(relations, mutation.anchor);
    mutation.deleteAtomIds.forEach((id) => relations.factIds.add(atomContributionId(id)));
  } else {
    mutation.atomIds.forEach((id) => relations.factIds.add(atomContributionId(id)));
  }
}

function addInlineReferenceMutationRelations(
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

function addFieldDefinition(relations: MutableMutationRelations, fieldDefinitionId: string): void {
  relations.nodeIds.add(fieldDefinitionId);
  relations.fieldDefinitionIds.add(fieldDefinitionId);
}

function addPlacement(relations: MutableMutationRelations, parentNodeId: string, anchor: SequenceAnchor): void {
  addChildrenRelation(relations, parentNodeId);
  addAnchorRelations(relations, anchor);
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

function atomContributionId(atomId: `${string}#${number}`): string {
  return atomId.slice(0, atomId.lastIndexOf("#"));
}

function assertNever(value: never): never {
  throw new Error(`Unhandled mutation: ${JSON.stringify(value)}`);
}
