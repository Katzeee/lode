import { templateInstanceNodeId } from "./identity.js";
import {
  addAnchorRelations,
  addChildrenRelation,
  addSchemaRelation,
  createMutationRelationCollection,
  finishMutationRelationCollection,
  type MutableMutationRelations,
  type MutationRelations,
} from "./mutation-relation-collection.js";
import type {
  FieldMutation,
  NodeMutation,
  OccurrenceMutation,
  SchemaMutation,
  TemplateMutation,
  TextMutation,
  ValueMutation,
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
    case "occurrence-create":
    case "occurrence-delete":
    case "occurrence-restore":
    case "occurrence-move":
      addOccurrenceMutationRelations(relations, mutation);
      break;
    case "schema-apply":
    case "schema-remove":
    case "schema-field-add":
    case "schema-field-remove":
    case "schema-field-configure":
    case "schema-extension-add":
    case "schema-extension-remove":
    case "schema-template-node-add":
    case "schema-template-node-remove":
      addSchemaMutationRelations(relations, mutation);
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
    case "text-splice":
    case "text-mark":
      addTextMutationRelations(relations, mutation);
      break;
    case "value-set":
    case "value-unset":
      addValueMutationRelations(relations, mutation);
      break;
    default:
      assertNever(mutation);
  }
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

function addSchemaMutationRelations(relations: MutableMutationRelations, mutation: SchemaMutation): void {
  addSchemaRelation(relations, mutation.schemaId);
  if (mutation.kind === "schema-apply" || mutation.kind === "schema-remove") {
    relations.nodeIds.add(mutation.nodeId);
    addRelationAnchor(relations, mutation);
    return;
  }
  if (mutation.kind === "schema-extension-add" || mutation.kind === "schema-extension-remove") {
    addSchemaRelation(relations, mutation.baseSchemaId);
    relations.instanceSchemaIds.add(mutation.schemaId);
    relations.instanceSchemaIds.add(mutation.baseSchemaId);
    addRelationAnchor(relations, mutation);
    return;
  }
  if (mutation.kind === "schema-template-node-add" || mutation.kind === "schema-template-node-remove") {
    relations.nodeIds.add(mutation.templateNodeId);
    relations.occurrenceIds.add(mutation.templateOccurrenceId);
    addRelationAnchor(relations, mutation);
    return;
  }
  addFieldDefinition(relations, mutation.fieldDefinitionId);
  relations.nodeIds.add(mutation.fieldNodeId);
  relations.instanceSchemaIds.add(mutation.schemaId);
  if (mutation.kind === "schema-field-configure") {
    mutation.observedConfigFactIds?.forEach((id) => relations.factIds.add(id));
  } else {
    relations.occurrenceIds.add(mutation.fieldOccurrenceId);
    addRelationAnchor(relations, mutation);
  }
}

function addRelationAnchor(
  relations: MutableMutationRelations,
  mutation: Exclude<SchemaMutation, { kind: "schema-field-configure" }>,
): void {
  if (
    mutation.kind === "schema-apply" ||
    mutation.kind === "schema-field-add" ||
    mutation.kind === "schema-extension-add" ||
    mutation.kind === "schema-template-node-add"
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
  mutation.sourceSchemaIds?.forEach((schemaId) => addSchemaRelation(relations, schemaId));
  mutation.sourceApplicationSchemaIds?.forEach((schemaId) => {
    addSchemaRelation(relations, schemaId);
    relations.instanceSchemaIds.add(schemaId);
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
    addSchemaRelation(relations, mutation.schemaId);
    relations.instanceSchemaIds.add(mutation.schemaId);
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

function addValueMutationRelations(relations: MutableMutationRelations, mutation: ValueMutation): void {
  if (mutation.target.kind === "node") {
    relations.nodeIds.add(mutation.target.id);
  } else {
    relations.occurrenceIds.add(mutation.target.id);
  }
  relations.values.push({ target: mutation.target, namespace: mutation.namespace });
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
