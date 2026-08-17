import { templateInstanceNodeId } from "./identity.js";
import {
  addAnchorRelations,
  addSupertagRelation,
  type MutableMutationRelations,
} from "./mutation-relation-collection.js";
import type { TemplateMutation } from "./mutation-family.js";

export function addTemplateMutationRelations(relations: MutableMutationRelations, mutation: TemplateMutation): void {
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
