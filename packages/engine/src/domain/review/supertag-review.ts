import { canonicalJson, isSupertagMutation, type ContributionFact, type SupertagMutation } from "../fact/index.js";
import { impactAddress, type ScopedProjection, type ScopedProjectionGeneration } from "../reconcile/index.js";
import type { SupertagRelationDecisionEffect } from "./types.js";
import { addAffectedFieldImpacts } from "./field-impacts.js";

export function supertagRelationEffect(
  fact: ContributionFact,
  generation: ScopedProjectionGeneration,
): SupertagRelationDecisionEffect {
  const mutation = fact.body.mutation;
  if (!isSupertagMutation(mutation)) {
    throw new Error("Supertag relation effect requires a Supertag relation Mutation");
  }
  const relation = supertagRelationKind(mutation);
  const [ownerId, targetId] = supertagRelationIdentities(mutation);
  return {
    kind: "supertag-relation",
    relation,
    ownerId,
    targetId,
    originIndex: relationIndex(generation.origin, relation, ownerId, targetId),
    reviewIndex: relationIndex(generation.review, relation, ownerId, targetId),
  };
}

export function addSupertagRelationImpacts(
  impacts: Set<string>,
  fact: ContributionFact,
  generation: ScopedProjectionGeneration,
): void {
  const mutation = fact.body.mutation;
  if (!isSupertagMutation(mutation)) {
    return;
  }
  if (mutation.kind === "supertag-template-node-add" || mutation.kind === "supertag-template-node-remove") {
    impacts.add(supertagRelationAddress(mutation));
    for (const instance of [...generation.origin.templateNodeInstances, ...generation.review.templateNodeInstances]) {
      if (
        instance.templateNodeId === mutation.templateNodeId &&
        instance.sources.some((source) => source.supertagId === mutation.supertagId)
      ) {
        impacts.add(instance.instanceOccurrenceId);
        impacts.add(impactAddress("template-node", instance.ownerNodeId, instance.templateNodeId));
      }
    }
    return;
  }
  const nodeIds =
    mutation.kind === "supertag-apply" || mutation.kind === "supertag-remove"
      ? [mutation.nodeId]
      : nodesApplyingSupertag(generation, mutation.supertagId);
  const fieldIds =
    mutation.kind === "supertag-apply" || mutation.kind === "supertag-remove"
      ? fieldsOfSupertag(generation, mutation.supertagId)
      : mutation.kind === "supertag-extension-add" || mutation.kind === "supertag-extension-remove"
        ? [
            ...fieldsOfSupertag(generation, mutation.supertagId),
            ...fieldsOfSupertag(generation, mutation.baseSupertagId),
          ]
        : [mutation.fieldDefinitionId];
  impacts.add(supertagRelationAddress(mutation));
  for (const nodeId of nodeIds) {
    for (const fieldDefinitionId of fieldIds) {
      const origin = effectiveField(generation.origin, nodeId, fieldDefinitionId);
      const review = effectiveField(generation.review, nodeId, fieldDefinitionId);
      if (canonicalJson(origin) !== canonicalJson(review)) {
        addAffectedFieldImpacts(impacts, nodeId, fieldDefinitionId, generation);
      }
    }
  }
}

export function supertagRelationAddress(mutation: SupertagMutation): string {
  if (mutation.kind === "supertag-apply" || mutation.kind === "supertag-remove") {
    return impactAddress("supertag-application", mutation.nodeId, mutation.supertagId);
  }
  if (mutation.kind === "supertag-extension-add" || mutation.kind === "supertag-extension-remove") {
    return impactAddress("supertag-extension", mutation.supertagId, mutation.baseSupertagId);
  }
  return mutation.kind === "supertag-template-node-add" || mutation.kind === "supertag-template-node-remove"
    ? impactAddress("supertag-template-node", mutation.supertagId, mutation.templateNodeId)
    : impactAddress("supertag-field", mutation.supertagId, mutation.fieldDefinitionId);
}

function relationIndex(
  projection: ScopedProjection,
  relation: SupertagRelationDecisionEffect["relation"],
  ownerId: string,
  targetId: string,
): number | null {
  const values =
    relation === "application"
      ? projection.supertagApplications[ownerId]
      : relation === "extension"
        ? projection.supertagExtensions[ownerId]
        : relation === "template-node"
          ? projection.supertagTemplateNodes[ownerId]
          : projection.supertagFields[ownerId];
  const index = values?.indexOf(targetId);
  return index === undefined || index < 0 ? null : index;
}

function supertagRelationKind(mutation: SupertagMutation): SupertagRelationDecisionEffect["relation"] {
  if (mutation.kind === "supertag-apply" || mutation.kind === "supertag-remove") {
    return "application";
  }
  return mutation.kind === "supertag-extension-add" || mutation.kind === "supertag-extension-remove"
    ? "extension"
    : mutation.kind === "supertag-template-node-add" || mutation.kind === "supertag-template-node-remove"
      ? "template-node"
      : "field";
}

function supertagRelationIdentities(mutation: SupertagMutation): readonly [ownerId: string, targetId: string] {
  if (mutation.kind === "supertag-apply" || mutation.kind === "supertag-remove") {
    return [mutation.nodeId, mutation.supertagId];
  }
  return mutation.kind === "supertag-extension-add" || mutation.kind === "supertag-extension-remove"
    ? [mutation.supertagId, mutation.baseSupertagId]
    : mutation.kind === "supertag-template-node-add" || mutation.kind === "supertag-template-node-remove"
      ? [mutation.supertagId, mutation.templateNodeId]
      : [mutation.supertagId, mutation.fieldDefinitionId];
}

function fieldsOfSupertag(generation: ScopedProjectionGeneration, supertagId: string): readonly string[] {
  return [
    ...new Set([
      ...(generation.origin.supertagFields[supertagId] ?? []),
      ...(generation.review.supertagFields[supertagId] ?? []),
    ]),
  ];
}

function nodesApplyingSupertag(generation: ScopedProjectionGeneration, supertagId: string): readonly string[] {
  return [
    ...new Set(
      [generation.origin, generation.review].flatMap((projection) => [
        ...(projection.supertagInstanceSupertags[supertagId] ?? []),
        ...Object.entries(projection.supertagApplications).flatMap(([nodeId, supertagIds]) =>
          supertagIds.includes(supertagId) ? [nodeId] : [],
        ),
      ]),
    ),
  ];
}

function effectiveField(projection: ScopedProjection, nodeId: string, fieldDefinitionId: string) {
  return projection.effectiveFields[nodeId]?.find((field) => field.fieldDefinitionId === fieldDefinitionId) ?? null;
}
