import type { SequenceAnchor } from "./types.js";

export type ActionRelations = Readonly<{
  nodeIds: readonly string[];
  occurrenceIds: readonly string[];
  actionIds: readonly string[];
  childrenOfNodeIds: readonly string[];
  supertagIds: readonly string[];
  instanceSupertagIds: readonly string[];
  fieldDefinitionIds: readonly string[];
  inlineReferenceIds: readonly string[];
}>;

export type MutableActionRelations = {
  nodeIds: Set<string>;
  occurrenceIds: Set<string>;
  actionIds: Set<string>;
  childrenOfNodeIds: Set<string>;
  supertagIds: Set<string>;
  instanceSupertagIds: Set<string>;
  fieldDefinitionIds: Set<string>;
  inlineReferenceIds: Set<string>;
};

export function createActionRelationCollection(): MutableActionRelations {
  return {
    nodeIds: new Set(),
    occurrenceIds: new Set(),
    actionIds: new Set(),
    childrenOfNodeIds: new Set(),
    supertagIds: new Set(),
    instanceSupertagIds: new Set(),
    fieldDefinitionIds: new Set(),
    inlineReferenceIds: new Set(),
  };
}

export function finishActionRelationCollection(relations: MutableActionRelations): ActionRelations {
  return {
    nodeIds: [...relations.nodeIds],
    occurrenceIds: [...relations.occurrenceIds],
    actionIds: [...relations.actionIds],
    childrenOfNodeIds: [...relations.childrenOfNodeIds],
    supertagIds: [...relations.supertagIds],
    instanceSupertagIds: [...relations.instanceSupertagIds],
    fieldDefinitionIds: [...relations.fieldDefinitionIds],
    inlineReferenceIds: [...relations.inlineReferenceIds],
  };
}

export function addSupertagRelation(relations: MutableActionRelations, supertagId: string): void {
  relations.nodeIds.add(supertagId);
  relations.supertagIds.add(supertagId);
}

export function addChildrenRelation(relations: MutableActionRelations, nodeId: string): void {
  relations.nodeIds.add(nodeId);
  relations.childrenOfNodeIds.add(nodeId);
}

export function addAnchorRelations(relations: MutableActionRelations, anchor: SequenceAnchor | undefined): void {
  if (anchor?.after !== null && anchor?.after !== undefined) {
    relations.occurrenceIds.add(anchor.after);
  }
  if (anchor?.before !== null && anchor?.before !== undefined) {
    relations.occurrenceIds.add(anchor.before);
  }
}
