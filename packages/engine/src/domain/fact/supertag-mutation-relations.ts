import {
  addAnchorRelations,
  addSupertagRelation,
  type MutableMutationRelations,
} from "./mutation-relation-collection.js";
import type { SupertagMutation } from "./mutation-family.js";

export function addSupertagMutationRelations(relations: MutableMutationRelations, mutation: SupertagMutation): void {
  addSupertagRelation(relations, mutation.supertagId);
  if (mutation.kind === "supertag-template-field-discoverability-set") {
    relations.nodeIds.add(mutation.templateFieldNodeId);
    addFieldDefinition(relations, mutation.fieldDefinitionId);
    return;
  }
  if (mutation.kind === "supertag-template-field-visibility-configure") {
    relations.nodeIds.add(mutation.templateFieldNodeId);
    addFieldDefinition(relations, mutation.fieldDefinitionId);
    mutation.observedVisibilityFactIds?.forEach((id) => relations.factIds.add(id));
    return;
  }
  if (
    mutation.kind === "supertag-template-field-attach" ||
    mutation.kind === "supertag-template-field-existing-attach" ||
    mutation.kind === "supertag-template-field-detach"
  ) {
    relations.nodeIds.add(mutation.templateFieldNodeId);
    relations.nodeIds.add(mutation.staticDefaultValueNodeId);
    addFieldDefinition(relations, mutation.fieldDefinitionId);
    relations.occurrenceIds.add(mutation.templateFieldOccurrenceId);
    relations.occurrenceIds.add(mutation.definitionOccurrenceId);
    relations.occurrenceIds.add(mutation.staticDefaultValueOccurrenceId);
    addRelationAnchor(relations, mutation);
    return;
  }
  if (
    mutation.kind === "supertag-optional-field-contribution-attach" ||
    mutation.kind === "supertag-optional-field-contribution-detach"
  ) {
    addOptionalFieldRelations(relations, mutation);
    return;
  }
  if (mutation.kind === "supertag-apply" || mutation.kind === "supertag-remove") {
    relations.nodeIds.add(mutation.hostNodeId);
    relations.nodeIds.add(mutation.applicationNodeId);
    relations.occurrenceIds.add(mutation.applicationOccurrenceId);
    relations.occurrenceIds.add(mutation.relationDefinitionOccurrenceId);
    relations.occurrenceIds.add(mutation.definitionOccurrenceId);
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
  }
}

function addOptionalFieldRelations(
  relations: MutableMutationRelations,
  mutation: Extract<
    SupertagMutation,
    { kind: "supertag-optional-field-contribution-attach" | "supertag-optional-field-contribution-detach" }
  >,
): void {
  for (const nodeId of [
    mutation.fieldNurseryNodeId,
    mutation.nurseryValueNodeId,
    mutation.contributionNodeId,
    mutation.valueNodeId,
  ]) {
    relations.nodeIds.add(nodeId);
  }
  addFieldDefinition(relations, mutation.fieldDefinitionId);
  for (const occurrenceId of [
    mutation.fieldNurseryOccurrenceId,
    mutation.nurseryDefinitionOccurrenceId,
    mutation.nurseryValueOccurrenceId,
    mutation.contributionOccurrenceId,
    mutation.definitionOccurrenceId,
    mutation.valueOccurrenceId,
  ]) {
    relations.occurrenceIds.add(occurrenceId);
  }
  addRelationAnchor(relations, mutation);
}

function addRelationAnchor(relations: MutableMutationRelations, mutation: SupertagMutation): void {
  if (
    mutation.kind === "supertag-apply" ||
    mutation.kind === "supertag-extension-add" ||
    mutation.kind === "supertag-template-node-add" ||
    mutation.kind === "supertag-template-field-attach" ||
    mutation.kind === "supertag-template-field-existing-attach" ||
    mutation.kind === "supertag-optional-field-contribution-attach"
  ) {
    addAnchorRelations(relations, mutation.anchor);
  } else if (
    mutation.kind === "supertag-remove" ||
    mutation.kind === "supertag-extension-remove" ||
    mutation.kind === "supertag-template-node-remove" ||
    mutation.kind === "supertag-template-field-detach" ||
    mutation.kind === "supertag-optional-field-contribution-detach"
  ) {
    addAnchorRelations(relations, mutation.previousAnchor);
  }
}

function addFieldDefinition(relations: MutableMutationRelations, fieldDefinitionId: string): void {
  relations.nodeIds.add(fieldDefinitionId);
  relations.fieldDefinitionIds.add(fieldDefinitionId);
}
