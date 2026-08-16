import { canonicalJson, compareFacts, isViewMutation, type ContributionFact } from "../fact/index.js";
import type { ScopedProjection, ScopedProjectionGeneration } from "../reconcile/index.js";
import type { HunkCandidate, ReviewFamilyRule } from "./review-family.js";
import { associatedNodeScope, reviewScope } from "./review-scope.js";
import type { ViewDefinitionDecisionEffect, ViewDefinitionDecisionState } from "./types.js";

const VIEW_MUTATION_KINDS = [
  "shared-default-view-definition-attach",
  "shared-default-view-definition-mode-set",
] as const;

export const viewDefinitionReviewFamily = {
  key: "view-definition",
  mutationKinds: VIEW_MUTATION_KINDS,
  scopes(fact) {
    const mutation = fact.body.mutation;
    if (!isViewMutation(mutation)) {
      throw new Error("View Definition Review family received another Mutation family");
    }
    return [
      reviewScope("view-definition", mutation.viewDefinitionNodeId),
      associatedNodeScope(mutation.viewDefinitionNodeId),
      ...(mutation.kind === "shared-default-view-definition-attach" ? [associatedNodeScope(mutation.hostNodeId)] : []),
    ];
  },
  candidates: ({ generation, pending }) => viewDefinitionCandidates(generation, pending),
  effect(fact, _targets, generation) {
    const mutation = fact.body.mutation;
    if (!isViewMutation(mutation)) {
      throw new Error("View Definition Review family received another Mutation family");
    }
    const effect = viewDefinitionEffect(mutation.viewDefinitionNodeId, generation);
    return canonicalJson(effect.origin) === canonicalJson(effect.review)
      ? null
      : { identity: `view-definition/${mutation.viewDefinitionNodeId}`, effect };
  },
  addImpacts(impacts, targets, generation) {
    for (const fact of targets) {
      const mutation = fact.body.mutation;
      if (!isViewMutation(mutation)) {
        continue;
      }
      impacts.add(mutation.viewDefinitionNodeId);
      const effect = viewDefinitionEffect(mutation.viewDefinitionNodeId, generation);
      for (const state of [effect.origin, effect.review]) {
        if (state) {
          impacts.add(state.hostNodeId);
        }
      }
    }
  },
} satisfies ReviewFamilyRule;

function viewDefinitionCandidates(
  generation: ScopedProjectionGeneration,
  pending: ReadonlyMap<string, ContributionFact>,
): readonly HunkCandidate[] {
  const groups = new Map<string, ContributionFact[]>();
  for (const fact of pending.values()) {
    const mutation = fact.body.mutation;
    if (!isViewMutation(mutation)) {
      continue;
    }
    const facts = groups.get(mutation.viewDefinitionNodeId) ?? [];
    facts.push(fact);
    groups.set(mutation.viewDefinitionNodeId, facts);
  }
  return [...groups].flatMap(([viewDefinitionNodeId, facts]) => {
    const effect = viewDefinitionEffect(viewDefinitionNodeId, generation);
    return canonicalJson(effect.origin) === canonicalJson(effect.review)
      ? []
      : [
          {
            diffSpace: { kind: "view-definition" as const, identity: viewDefinitionNodeId },
            targets: [...facts].sort(compareFacts).map((fact) => fact.id),
            bridges: [],
          },
        ];
  });
}

function viewDefinitionEffect(
  viewDefinitionNodeId: string,
  generation: ScopedProjectionGeneration,
): ViewDefinitionDecisionEffect {
  return {
    kind: "view-definition",
    viewDefinitionNodeId,
    origin: viewDefinitionState(viewDefinitionNodeId, generation.origin),
    review: viewDefinitionState(viewDefinitionNodeId, generation.review),
  };
}

function viewDefinitionState(
  viewDefinitionNodeId: string,
  projection: ScopedProjection,
): ViewDefinitionDecisionState | null {
  const definition = Object.values(projection.sharedDefaultViewDefinitions)
    .flat()
    .find((candidate) => candidate.viewDefinitionNodeId === viewDefinitionNodeId);
  return definition ? { hostNodeId: definition.hostNodeId, viewType: definition.viewType } : null;
}
