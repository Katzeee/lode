import { isSupertagMutation, type ContributionFact, type SupertagMutation } from "../fact/index.js";
import { impactAddress, type ScopedProjection, type ScopedProjectionGeneration } from "../reconcile/index.js";
import type { SupertagRelationDecisionEffect } from "./types.js";

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
  if (mutation.kind === "supertag-template-field-visibility-configure") {
    impacts.add(impactAddress("supertag-template-field-visibility", mutation.supertagId, mutation.templateFieldNodeId));
    return;
  }
  impacts.add(supertagRelationAddress(mutation));
}

export function supertagRelationAddress(mutation: SupertagMutation): string {
  if (mutation.kind === "supertag-apply" || mutation.kind === "supertag-remove") {
    return impactAddress("supertag-application", mutation.hostNodeId, mutation.applicationNodeId);
  }
  if (mutation.kind === "supertag-extension-add" || mutation.kind === "supertag-extension-remove") {
    return impactAddress("supertag-extension", mutation.supertagId, mutation.baseSupertagId);
  }
  if (mutation.kind === "supertag-template-node-add" || mutation.kind === "supertag-template-node-remove") {
    return impactAddress("supertag-template-node", mutation.supertagId, mutation.templateNodeId);
  }
  if (mutation.kind === "supertag-template-field-visibility-configure") {
    return impactAddress("supertag-template-field-visibility", mutation.supertagId, mutation.templateFieldNodeId);
  }
  throw new Error("Template Field relations use their structural review effects");
}

function relationIndex(
  projection: ScopedProjection,
  relation: SupertagRelationDecisionEffect["relation"],
  ownerId: string,
  targetId: string,
): number | null {
  if (relation === "template-field-visibility") {
    const field = projection.templateFields[ownerId]?.find((candidate) => candidate.templateFieldNodeId === targetId);
    return field === undefined ? null : field.visibility === "pinned" ? 1 : 0;
  }
  const values =
    relation === "application"
      ? projection.supertagApplications[ownerId]
      : relation === "extension"
        ? projection.supertagExtensions[ownerId]
        : projection.supertagTemplateNodes[ownerId];
  const index =
    relation === "application"
      ? (values as ScopedProjection["supertagApplications"][string] | undefined)?.findIndex(
          (application) => application.applicationNodeId === targetId,
        )
      : (values as readonly string[] | undefined)?.indexOf(targetId);
  return index === undefined || index < 0 ? null : index;
}

function supertagRelationKind(mutation: SupertagMutation): SupertagRelationDecisionEffect["relation"] {
  if (mutation.kind === "supertag-apply" || mutation.kind === "supertag-remove") {
    return "application";
  }
  if (mutation.kind === "supertag-extension-add" || mutation.kind === "supertag-extension-remove") {
    return "extension";
  }
  if (mutation.kind === "supertag-template-node-add" || mutation.kind === "supertag-template-node-remove") {
    return "template-node";
  }
  if (mutation.kind === "supertag-template-field-visibility-configure") {
    return "template-field-visibility";
  }
  throw new Error("Template Field relations use their structural review effects");
}

function supertagRelationIdentities(mutation: SupertagMutation): readonly [ownerId: string, targetId: string] {
  if (mutation.kind === "supertag-apply" || mutation.kind === "supertag-remove") {
    return [mutation.hostNodeId, mutation.applicationNodeId];
  }
  if (mutation.kind === "supertag-extension-add" || mutation.kind === "supertag-extension-remove") {
    return [mutation.supertagId, mutation.baseSupertagId];
  }
  if (mutation.kind === "supertag-template-node-add" || mutation.kind === "supertag-template-node-remove") {
    return [mutation.supertagId, mutation.templateNodeId];
  }
  if (mutation.kind === "supertag-template-field-visibility-configure") {
    return [mutation.supertagId, mutation.templateFieldNodeId];
  }
  throw new Error("Template Field relations use their structural review effects");
}
