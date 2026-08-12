import type { EditIntent, FactSnapshot, Mutation, ViewMode } from "../../domain/fact/index.js";
import type { Projection, ProjectionGeneration } from "../../domain/reconcile/index.js";
import {
  applyMutationToPlanningProjection,
  type MutableProjection,
} from "./planning-projection-mutation.js";

export function applyPlanningMutation(
  generation: ProjectionGeneration,
  mutation: Mutation,
  factId: string,
  intent: EditIntent,
  snapshot: FactSnapshot,
): ProjectionGeneration {
  const origin =
    intent === "direct"
      ? applyToProjection(generation.origin, mutation, factId, snapshot, "origin")
      : generation.origin;
  const review = applyToProjection(generation.review, mutation, factId, snapshot, "review");
  return { ...generation, origin, review };
}

function applyToProjection(
  projection: Projection,
  mutation: Mutation,
  factId: string,
  snapshot: FactSnapshot,
  view: ViewMode,
): Projection {
  const next: MutableProjection = {
    ...projection,
    nodes: Object.fromEntries(
      Object.entries(projection.nodes).map(([id, node]) => [
        id,
        {
          ...node,
          text: node.text.map((atom) => ({ ...atom, attributes: { ...atom.attributes } })),
          properties: { ...node.properties },
          metadata: { ...node.metadata },
        },
      ]),
    ),
    occurrences: Object.fromEntries(
      Object.entries(projection.occurrences).map(([id, occurrence]) => [
        id,
        {
          ...occurrence,
          properties: { ...occurrence.properties },
          metadata: { ...occurrence.metadata },
        },
      ]),
    ),
    children: Object.fromEntries(
      Object.entries(projection.children).map(([id, ids]) => [id, [...ids]]),
    ),
    canonicalOccurrences: { ...projection.canonicalOccurrences },
    addressedValues: Object.fromEntries(
      Object.entries(projection.addressedValues).map(([address, values]) => [
        address,
        { ...values },
      ]),
    ),
    schemaApplications: Object.fromEntries(
      Object.entries(projection.schemaApplications).map(([id, schemaIds]) => [id, [...schemaIds]]),
    ),
    schemaFields: Object.fromEntries(
      Object.entries(projection.schemaFields).map(([id, fieldIds]) => [id, [...fieldIds]]),
    ),
    schemaFieldItems: Object.fromEntries(
      Object.entries(projection.schemaFieldItems).map(([id, items]) => [id, [...items]]),
    ),
    schemaTemplateNodes: Object.fromEntries(
      Object.entries(projection.schemaTemplateNodes).map(([id, nodeIds]) => [id, [...nodeIds]]),
    ),
    templateNodeInstances: projection.templateNodeInstances.map((instance) => ({
      ...instance,
      sources: instance.sources.map((source) => ({ ...source })),
      detachmentContributionIds: [...instance.detachmentContributionIds],
    })),
    schemaExtensions: Object.fromEntries(
      Object.entries(projection.schemaExtensions).map(([id, schemaIds]) => [id, [...schemaIds]]),
    ),
    schemaSearchMembers: Object.fromEntries(
      Object.entries(projection.schemaSearchMembers).map(([id, schemaIds]) => [id, [...schemaIds]]),
    ),
    schemaExtensionConflicts: Object.fromEntries(
      Object.entries(projection.schemaExtensionConflicts).map(([id, schemaIds]) => [
        id,
        [...schemaIds],
      ]),
    ),
    definitionStatuses: Object.fromEntries(
      Object.entries(projection.definitionStatuses).map(([id, status]) => [
        id,
        { ...status, kinds: [...status.kinds], deletionFactIds: [...status.deletionFactIds] },
      ]),
    ),
    conflictIssues: projection.conflictIssues,
    effectiveFields: projection.effectiveFields,
    materializedFields: Object.fromEntries(
      Object.entries(projection.materializedFields).map(([id, fields]) => [id, [...fields]]),
    ),
    reviewScopes: projection.reviewScopes,
    supportByContribution: projection.supportByContribution,
  };
  applyMutationToPlanningProjection(next, mutation, factId, snapshot, view);
  return next;
}
