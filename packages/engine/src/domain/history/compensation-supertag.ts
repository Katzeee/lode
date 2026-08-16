import {
  compareFacts,
  isSupertagMutation,
  type ContributionFact,
  type Mutation,
  type SupertagMutation,
} from "../fact/index.js";
import { sequenceAnchorAt, type ScopedProjection } from "../reconcile/index.js";
import { noCompensation, type CompensationStep } from "./compensation-types.js";

export function compensateSupertagMutation(
  target: ContributionFact,
  activeFacts: readonly ContributionFact[],
  projection: ScopedProjection,
): CompensationStep | null {
  const mutation = target.body.mutation;
  if (!isSupertagMutation(mutation)) {
    return null;
  }
  if (hasLaterRelationEdit(target, activeFacts)) {
    return noCompensation();
  }
  if (mutation.kind === "supertag-apply") {
    return contains(projection, mutation)
      ? ready({
          kind: "supertag-remove",
          nodeId: mutation.nodeId,
          supertagId: mutation.supertagId,
          previousAnchor: currentAnchor(projection.supertagApplications[mutation.nodeId] ?? [], mutation.supertagId),
        })
      : noCompensation();
  }
  if (mutation.kind === "supertag-remove") {
    return !contains(projection, mutation) && mutation.previousAnchor
      ? ready({
          kind: "supertag-apply",
          nodeId: mutation.nodeId,
          supertagId: mutation.supertagId,
          anchor: mutation.previousAnchor,
        })
      : noCompensation();
  }
  if (mutation.kind === "supertag-field-add") {
    return contains(projection, mutation)
      ? ready({
          kind: "supertag-field-remove",
          supertagId: mutation.supertagId,
          fieldDefinitionId: mutation.fieldDefinitionId,
          fieldNodeId: mutation.fieldNodeId,
          fieldOccurrenceId: mutation.fieldOccurrenceId,
          previousAnchor: currentAnchor(
            projection.childOccurrences[mutation.supertagId] ?? [],
            mutation.fieldOccurrenceId,
          ),
        })
      : noCompensation();
  }
  if (mutation.kind === "supertag-field-remove") {
    return !contains(projection, mutation) && mutation.previousAnchor
      ? ready({
          kind: "supertag-field-add",
          supertagId: mutation.supertagId,
          fieldDefinitionId: mutation.fieldDefinitionId,
          fieldNodeId: mutation.fieldNodeId,
          fieldOccurrenceId: mutation.fieldOccurrenceId,
          anchor: mutation.previousAnchor,
        })
      : noCompensation();
  }
  if (mutation.kind === "supertag-field-configure") {
    return mutation.previousConfig == null
      ? noCompensation()
      : ready({
          kind: "supertag-field-configure",
          supertagId: mutation.supertagId,
          fieldDefinitionId: mutation.fieldDefinitionId,
          fieldNodeId: mutation.fieldNodeId,
          config: mutation.previousConfig,
          previousConfig: mutation.config,
          observedConfigFactIds: [target.id],
        });
  }
  if (mutation.kind === "supertag-extension-add") {
    return contains(projection, mutation)
      ? ready({
          kind: "supertag-extension-remove",
          supertagId: mutation.supertagId,
          baseSupertagId: mutation.baseSupertagId,
          previousAnchor: currentAnchor(
            projection.supertagExtensions[mutation.supertagId] ?? [],
            mutation.baseSupertagId,
          ),
        })
      : noCompensation();
  }
  if (mutation.kind === "supertag-extension-remove") {
    return !contains(projection, mutation) && mutation.previousAnchor
      ? ready({
          kind: "supertag-extension-add",
          supertagId: mutation.supertagId,
          baseSupertagId: mutation.baseSupertagId,
          anchor: mutation.previousAnchor,
        })
      : noCompensation();
  }
  return compensateTemplateNodeRelation(mutation, projection);
}

function compensateTemplateNodeRelation(
  mutation: Extract<Mutation, { kind: "supertag-template-node-add" | "supertag-template-node-remove" }>,
  projection: ScopedProjection,
): CompensationStep {
  if (mutation.kind === "supertag-template-node-add") {
    return contains(projection, mutation)
      ? ready({
          kind: "supertag-template-node-remove",
          supertagId: mutation.supertagId,
          templateNodeId: mutation.templateNodeId,
          templateOccurrenceId: mutation.templateOccurrenceId,
          previousAnchor: currentAnchor(
            projection.childOccurrences[mutation.supertagId] ?? [],
            mutation.templateOccurrenceId,
          ),
        })
      : noCompensation();
  }
  return !contains(projection, mutation) && mutation.previousAnchor
    ? ready({
        kind: "supertag-template-node-add",
        supertagId: mutation.supertagId,
        templateNodeId: mutation.templateNodeId,
        templateOccurrenceId: mutation.templateOccurrenceId,
        anchor: mutation.previousAnchor,
      })
    : noCompensation();
}

function ready(mutation: Mutation): CompensationStep {
  return { kind: "ready", mutations: [mutation] };
}

function contains(projection: ScopedProjection, mutation: SupertagMutation): boolean {
  if (mutation.kind === "supertag-apply" || mutation.kind === "supertag-remove") {
    return (projection.supertagApplications[mutation.nodeId] ?? []).includes(mutation.supertagId);
  }
  if (
    mutation.kind === "supertag-field-add" ||
    mutation.kind === "supertag-field-remove" ||
    mutation.kind === "supertag-field-configure"
  ) {
    return (projection.templateFields[mutation.supertagId] ?? []).some(
      (field) => field.fieldNodeId === mutation.fieldNodeId,
    );
  }
  if (mutation.kind === "supertag-extension-add" || mutation.kind === "supertag-extension-remove") {
    return (projection.supertagExtensions[mutation.supertagId] ?? []).includes(mutation.baseSupertagId);
  }
  const occurrence = projection.occurrences[mutation.templateOccurrenceId];
  return occurrence?.nodeId === mutation.templateNodeId && occurrence.parentNodeId === mutation.supertagId;
}

function currentAnchor(identities: readonly string[], identity: string) {
  return sequenceAnchorAt(identities, identities.indexOf(identity));
}

function hasLaterRelationEdit(target: ContributionFact, activeFacts: readonly ContributionFact[]): boolean {
  const mutation = target.body.mutation;
  if (!isSupertagMutation(mutation)) {
    return false;
  }
  return activeFacts.some(
    (fact) =>
      compareFacts(target, fact) < 0 &&
      isSupertagMutation(fact.body.mutation) &&
      relationOwner(fact.body.mutation) === relationOwner(mutation),
  );
}

function relationOwner(mutation: SupertagMutation): string {
  if (mutation.kind === "supertag-apply" || mutation.kind === "supertag-remove") {
    return JSON.stringify(["application", mutation.nodeId, mutation.supertagId]);
  }
  if (
    mutation.kind === "supertag-field-add" ||
    mutation.kind === "supertag-field-remove" ||
    mutation.kind === "supertag-field-configure"
  ) {
    return JSON.stringify(["field", mutation.fieldNodeId]);
  }
  if (mutation.kind === "supertag-extension-add" || mutation.kind === "supertag-extension-remove") {
    return JSON.stringify(["extension", mutation.supertagId, mutation.baseSupertagId]);
  }
  return JSON.stringify(["template-node", mutation.supertagId, mutation.templateNodeId]);
}
