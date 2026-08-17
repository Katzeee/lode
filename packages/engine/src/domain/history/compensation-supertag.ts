import {
  compareFacts,
  detachedSupertagValueNodeId,
  detachedSupertagValueOccurrenceId,
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
  if (mutation.kind === "supertag-apply" || mutation.kind === "supertag-remove") {
    return compensateSupertagApplication(mutation, projection);
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
  if (mutation.kind === "supertag-template-node-add" || mutation.kind === "supertag-template-node-remove") {
    return compensateTemplateNodeRelation(mutation, projection);
  }
  if (
    mutation.kind === "supertag-template-field-attach" ||
    mutation.kind === "supertag-template-field-existing-attach" ||
    mutation.kind === "supertag-template-field-detach" ||
    mutation.kind === "supertag-template-field-discoverability-set" ||
    mutation.kind === "supertag-template-field-visibility-configure"
  ) {
    return compensateTemplateFieldRelation(mutation, projection);
  }
  if (mutation.kind === "supertag-optional-field-contribution-attach") {
    return contains(projection, mutation)
      ? ready({
          ...mutation,
          kind: "supertag-optional-field-contribution-detach",
          previousAnchor: currentAnchor(
            projection.childOccurrences[mutation.nurseryValueNodeId] ?? [],
            mutation.contributionOccurrenceId,
          ),
        })
      : noCompensation();
  }
  return !contains(projection, mutation) && mutation.previousAnchor
    ? ready({ ...mutation, kind: "supertag-optional-field-contribution-attach", anchor: mutation.previousAnchor })
    : noCompensation();
}

function compensateTemplateFieldRelation(
  mutation: Extract<
    SupertagMutation,
    {
      kind:
        | "supertag-template-field-attach"
        | "supertag-template-field-existing-attach"
        | "supertag-template-field-detach"
        | "supertag-template-field-discoverability-set"
        | "supertag-template-field-visibility-configure";
    }
  >,
  projection: ScopedProjection,
): CompensationStep {
  if (mutation.kind === "supertag-template-field-discoverability-set") {
    return mutation.previousDiscoverable === undefined
      ? noCompensation()
      : ready({
          ...mutation,
          discoverable: mutation.previousDiscoverable,
          previousDiscoverable: mutation.discoverable,
        });
  }
  if (mutation.kind === "supertag-template-field-visibility-configure") {
    if (mutation.previousVisibility === undefined) {
      return noCompensation();
    }
    const current = (projection.templateFields[mutation.supertagId] ?? []).find(
      (field) => field.templateFieldNodeId === mutation.templateFieldNodeId,
    );
    return current === undefined
      ? noCompensation()
      : ready({
          kind: mutation.kind,
          supertagId: mutation.supertagId,
          templateFieldNodeId: mutation.templateFieldNodeId,
          fieldDefinitionId: mutation.fieldDefinitionId,
          visibility: mutation.previousVisibility,
          previousVisibility: current.visibility,
          observedVisibilityFactIds: current.visibilityCandidates.map((candidate) => candidate.contributionId),
        });
  }
  if (mutation.kind === "supertag-template-field-detach") {
    return !contains(projection, mutation) && mutation.previousAnchor
      ? ready({
          kind: "supertag-template-field-existing-attach",
          ...templateFieldIdentity(mutation),
          anchor: mutation.previousAnchor,
        })
      : noCompensation();
  }
  return contains(projection, mutation)
    ? ready({
        kind: "supertag-template-field-detach",
        ...templateFieldIdentity(mutation),
        previousAnchor: currentAnchor(
          projection.childOccurrences[mutation.supertagId] ?? [],
          mutation.templateFieldOccurrenceId,
        ),
      })
    : noCompensation();
}

function templateFieldIdentity(
  mutation: Extract<
    SupertagMutation,
    {
      kind:
        "supertag-template-field-attach" | "supertag-template-field-existing-attach" | "supertag-template-field-detach";
    }
  >,
) {
  return {
    supertagId: mutation.supertagId,
    templateFieldNodeId: mutation.templateFieldNodeId,
    templateFieldOccurrenceId: mutation.templateFieldOccurrenceId,
    fieldDefinitionId: mutation.fieldDefinitionId,
    definitionOccurrenceId: mutation.definitionOccurrenceId,
    staticDefaultValueNodeId: mutation.staticDefaultValueNodeId,
    staticDefaultValueOccurrenceId: mutation.staticDefaultValueOccurrenceId,
  } as const;
}

function compensateSupertagApplication(
  mutation: Extract<SupertagMutation, { kind: "supertag-apply" | "supertag-remove" }>,
  projection: ScopedProjection,
): CompensationStep {
  if (mutation.kind === "supertag-apply") {
    return contains(projection, mutation)
      ? ready({
          kind: "supertag-remove",
          hostNodeId: mutation.hostNodeId,
          supertagId: mutation.supertagId,
          applicationNodeId: mutation.applicationNodeId,
          applicationOccurrenceId: mutation.applicationOccurrenceId,
          relationDefinitionOccurrenceId: mutation.relationDefinitionOccurrenceId,
          definitionOccurrenceId: mutation.definitionOccurrenceId,
          detachedValueNodeId: detachedSupertagValueNodeId(mutation.applicationNodeId),
          detachedValueOccurrenceId: detachedSupertagValueOccurrenceId(mutation.applicationNodeId),
          previousAnchor: applicationAnchor(projection, mutation),
        })
      : noCompensation();
  }
  return !contains(projection, mutation) && mutation.previousAnchor
    ? ready({
        kind: "supertag-apply",
        hostNodeId: mutation.hostNodeId,
        supertagId: mutation.supertagId,
        applicationNodeId: mutation.applicationNodeId,
        applicationOccurrenceId: mutation.applicationOccurrenceId,
        relationDefinitionOccurrenceId: mutation.relationDefinitionOccurrenceId,
        definitionOccurrenceId: mutation.definitionOccurrenceId,
        anchor: mutation.previousAnchor,
      })
    : noCompensation();
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
    return (projection.supertagApplications[mutation.hostNodeId] ?? []).some(
      (application) => application.applicationNodeId === mutation.applicationNodeId,
    );
  }
  if (mutation.kind === "supertag-extension-add" || mutation.kind === "supertag-extension-remove") {
    return (projection.supertagExtensions[mutation.supertagId] ?? []).includes(mutation.baseSupertagId);
  }
  if (mutation.kind === "supertag-template-node-add" || mutation.kind === "supertag-template-node-remove") {
    const occurrence = projection.occurrences[mutation.templateOccurrenceId];
    return occurrence?.nodeId === mutation.templateNodeId && occurrence.parentNodeId === mutation.supertagId;
  }
  if (
    mutation.kind === "supertag-template-field-attach" ||
    mutation.kind === "supertag-template-field-existing-attach" ||
    mutation.kind === "supertag-template-field-detach" ||
    mutation.kind === "supertag-template-field-discoverability-set" ||
    mutation.kind === "supertag-template-field-visibility-configure"
  ) {
    return (projection.templateFields[mutation.supertagId] ?? []).some(
      (field) => field.templateFieldNodeId === mutation.templateFieldNodeId,
    );
  }
  return (projection.optionalFieldContributions[mutation.supertagId] ?? []).some(
    (field) => field.contributionNodeId === mutation.contributionNodeId,
  );
}

function currentAnchor(identities: readonly string[], identity: string) {
  return sequenceAnchorAt(identities, identities.indexOf(identity));
}

function applicationAnchor(
  projection: ScopedProjection,
  mutation: Extract<SupertagMutation, { kind: "supertag-apply" | "supertag-remove" }>,
) {
  const metanodeId = projection.metanodes[mutation.hostNodeId];
  return currentAnchor(
    metanodeId === undefined ? [] : (projection.childOccurrences[metanodeId] ?? []),
    mutation.applicationOccurrenceId,
  );
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
    return JSON.stringify(["application", mutation.applicationNodeId]);
  }
  if (mutation.kind === "supertag-extension-add" || mutation.kind === "supertag-extension-remove") {
    return JSON.stringify(["extension", mutation.supertagId, mutation.baseSupertagId]);
  }
  if (mutation.kind === "supertag-template-node-add" || mutation.kind === "supertag-template-node-remove") {
    return JSON.stringify(["template-node", mutation.supertagId, mutation.templateNodeId]);
  }
  if (
    mutation.kind === "supertag-template-field-attach" ||
    mutation.kind === "supertag-template-field-existing-attach" ||
    mutation.kind === "supertag-template-field-detach" ||
    mutation.kind === "supertag-template-field-discoverability-set" ||
    mutation.kind === "supertag-template-field-visibility-configure"
  ) {
    return JSON.stringify(["template-field", mutation.supertagId, mutation.templateFieldNodeId]);
  }
  return JSON.stringify(["optional-field", mutation.supertagId, mutation.contributionNodeId]);
}
