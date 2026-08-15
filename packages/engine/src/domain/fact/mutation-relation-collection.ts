import type { SequenceAnchor, ValueTarget } from "./types.js";

export type MutationValueRelation = Readonly<{
  target: ValueTarget;
  namespace: "property" | "metadata" | "schema";
}>;

export type MutationRelations = Readonly<{
  nodeIds: readonly string[];
  occurrenceIds: readonly string[];
  factIds: readonly string[];
  childrenOfNodeIds: readonly string[];
  schemaIds: readonly string[];
  instanceSchemaIds: readonly string[];
  fieldDefinitionIds: readonly string[];
  values: readonly MutationValueRelation[];
}>;

export type MutableMutationRelations = {
  nodeIds: Set<string>;
  occurrenceIds: Set<string>;
  factIds: Set<string>;
  childrenOfNodeIds: Set<string>;
  schemaIds: Set<string>;
  instanceSchemaIds: Set<string>;
  fieldDefinitionIds: Set<string>;
  values: MutationValueRelation[];
};

export function createMutationRelationCollection(): MutableMutationRelations {
  return {
    nodeIds: new Set(),
    occurrenceIds: new Set(),
    factIds: new Set(),
    childrenOfNodeIds: new Set(),
    schemaIds: new Set(),
    instanceSchemaIds: new Set(),
    fieldDefinitionIds: new Set(),
    values: [],
  };
}

export function finishMutationRelationCollection(relations: MutableMutationRelations): MutationRelations {
  return {
    nodeIds: [...relations.nodeIds],
    occurrenceIds: [...relations.occurrenceIds],
    factIds: [...relations.factIds],
    childrenOfNodeIds: [...relations.childrenOfNodeIds],
    schemaIds: [...relations.schemaIds],
    instanceSchemaIds: [...relations.instanceSchemaIds],
    fieldDefinitionIds: [...relations.fieldDefinitionIds],
    values: relations.values,
  };
}

export function addSchemaRelation(relations: MutableMutationRelations, schemaId: string): void {
  relations.nodeIds.add(schemaId);
  relations.schemaIds.add(schemaId);
}

export function addChildrenRelation(relations: MutableMutationRelations, nodeId: string): void {
  relations.nodeIds.add(nodeId);
  relations.childrenOfNodeIds.add(nodeId);
}

export function addAnchorRelations(relations: MutableMutationRelations, anchor: SequenceAnchor | undefined): void {
  if (anchor?.after !== null && anchor?.after !== undefined) {
    relations.occurrenceIds.add(anchor.after);
  }
  if (anchor?.before !== null && anchor?.before !== undefined) {
    relations.occurrenceIds.add(anchor.before);
  }
}
