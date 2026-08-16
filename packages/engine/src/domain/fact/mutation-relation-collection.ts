import type { SequenceAnchor } from "./types.js";

export type MutationRelations = Readonly<{
  nodeIds: readonly string[];
  occurrenceIds: readonly string[];
  factIds: readonly string[];
  childrenOfNodeIds: readonly string[];
  supertagIds: readonly string[];
  instanceSupertagIds: readonly string[];
  fieldDefinitionIds: readonly string[];
  inlineReferenceIds: readonly string[];
}>;

export type MutableMutationRelations = {
  nodeIds: Set<string>;
  occurrenceIds: Set<string>;
  factIds: Set<string>;
  childrenOfNodeIds: Set<string>;
  supertagIds: Set<string>;
  instanceSupertagIds: Set<string>;
  fieldDefinitionIds: Set<string>;
  inlineReferenceIds: Set<string>;
};

export function createMutationRelationCollection(): MutableMutationRelations {
  return {
    nodeIds: new Set(),
    occurrenceIds: new Set(),
    factIds: new Set(),
    childrenOfNodeIds: new Set(),
    supertagIds: new Set(),
    instanceSupertagIds: new Set(),
    fieldDefinitionIds: new Set(),
    inlineReferenceIds: new Set(),
  };
}

export function finishMutationRelationCollection(relations: MutableMutationRelations): MutationRelations {
  return {
    nodeIds: [...relations.nodeIds],
    occurrenceIds: [...relations.occurrenceIds],
    factIds: [...relations.factIds],
    childrenOfNodeIds: [...relations.childrenOfNodeIds],
    supertagIds: [...relations.supertagIds],
    instanceSupertagIds: [...relations.instanceSupertagIds],
    fieldDefinitionIds: [...relations.fieldDefinitionIds],
    inlineReferenceIds: [...relations.inlineReferenceIds],
  };
}

export function addSupertagRelation(relations: MutableMutationRelations, supertagId: string): void {
  relations.nodeIds.add(supertagId);
  relations.supertagIds.add(supertagId);
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
