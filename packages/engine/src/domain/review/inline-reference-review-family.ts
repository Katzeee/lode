import { canonicalJson, compareFacts, type ContributionFact } from "../fact/index.js";
import { locateInlineReference, type ScopedProjectionGeneration } from "../reconcile/index.js";
import type { HunkCandidate, ReviewFamilyRule } from "./review-family.js";
import { associatedNodeScope, reviewScope } from "./review-scope.js";
import type { InlineReferenceDecisionEffect, InlineReferenceDecisionState } from "./types.js";

const INLINE_REFERENCE_MUTATION_KINDS = [
  "inline-reference-create",
  "inline-reference-delete",
  "inline-reference-alias-attach",
  "inline-reference-alias-detach",
] as const;

export const inlineReferenceReviewFamily = {
  key: "inline-reference",
  mutationKinds: INLINE_REFERENCE_MUTATION_KINDS,
  scopes(fact) {
    const mutation = fact.body.mutation;
    if (!isInlineReferenceMutation(mutation)) {
      throw new Error("Inline Reference Review family received another Mutation family");
    }
    return [
      reviewScope("inline-reference", mutation.inlineReferenceId),
      ...(mutation.kind === "inline-reference-create"
        ? [associatedNodeScope(mutation.hostNodeId), associatedNodeScope(mutation.targetNodeId)]
        : mutation.kind === "inline-reference-delete"
          ? [
              ...(mutation.previousHostNodeId ? [associatedNodeScope(mutation.previousHostNodeId)] : []),
              ...(mutation.previousTargetNodeId ? [associatedNodeScope(mutation.previousTargetNodeId)] : []),
            ]
          : [associatedNodeScope(mutation.aliasNodeId)]),
    ];
  },
  candidates: ({ generation, pending }) => inlineReferenceCandidates(generation, pending),
  effect(fact, _targets, generation) {
    const mutation = fact.body.mutation;
    if (!isInlineReferenceMutation(mutation)) {
      throw new Error("Inline Reference Review family received another Mutation family");
    }
    const effect = inlineReferenceEffect(mutation.inlineReferenceId, generation);
    return canonicalJson(effect.origin) === canonicalJson(effect.review)
      ? null
      : { identity: `inline-reference/${mutation.inlineReferenceId}`, effect };
  },
  addImpacts(impacts, targets, generation) {
    for (const fact of targets) {
      const mutation = fact.body.mutation;
      if (!isInlineReferenceMutation(mutation)) {
        continue;
      }
      impacts.add(mutation.inlineReferenceId);
      const effect = inlineReferenceEffect(mutation.inlineReferenceId, generation);
      for (const state of [effect.origin, effect.review]) {
        if (state) {
          impacts.add(state.hostNodeId);
          impacts.add(state.targetNodeId);
          if (state.aliasNodeId !== null) {
            impacts.add(state.aliasNodeId);
          }
        }
      }
    }
  },
} satisfies ReviewFamilyRule;

function inlineReferenceCandidates(
  generation: ScopedProjectionGeneration,
  pending: ReadonlyMap<string, ContributionFact>,
): readonly HunkCandidate[] {
  const groups = new Map<string, ContributionFact[]>();
  for (const fact of pending.values()) {
    const mutation = fact.body.mutation;
    if (!isInlineReferenceMutation(mutation)) {
      continue;
    }
    const values = groups.get(mutation.inlineReferenceId) ?? [];
    values.push(fact);
    groups.set(mutation.inlineReferenceId, values);
  }
  return [...groups].flatMap(([inlineReferenceId, facts]) => {
    const effect = inlineReferenceEffect(inlineReferenceId, generation);
    return canonicalJson(effect.origin) === canonicalJson(effect.review)
      ? []
      : [
          {
            diffSpace: { kind: "inline-reference" as const, identity: inlineReferenceId },
            targets: [...facts].sort(compareFacts).map((fact) => fact.id),
            bridges: [],
          },
        ];
  });
}

function inlineReferenceEffect(
  inlineReferenceId: string,
  generation: ScopedProjectionGeneration,
): InlineReferenceDecisionEffect {
  return {
    kind: "inline-reference",
    inlineReferenceId,
    origin: stateFor(generation.origin.nodes, inlineReferenceId),
    review: stateFor(generation.review.nodes, inlineReferenceId),
  };
}

function stateFor(
  nodes: ScopedProjectionGeneration["origin"]["nodes"],
  inlineReferenceId: string,
): InlineReferenceDecisionState | null {
  const location = locateInlineReference(nodes, inlineReferenceId);
  return location === null
    ? null
    : {
        hostNodeId: location.hostNodeId,
        targetNodeId: location.reference.targetNodeId,
        aliasNodeId: location.reference.aliasNodeId,
        targetStatus: location.reference.targetStatus,
        anchor: location.anchor,
      };
}

function isInlineReferenceMutation(mutation: ContributionFact["body"]["mutation"]): mutation is Extract<
  ContributionFact["body"]["mutation"],
  {
    kind:
      | "inline-reference-create"
      | "inline-reference-delete"
      | "inline-reference-alias-attach"
      | "inline-reference-alias-detach";
  }
> {
  return INLINE_REFERENCE_MUTATION_KINDS.includes(mutation.kind as (typeof INLINE_REFERENCE_MUTATION_KINDS)[number]);
}
