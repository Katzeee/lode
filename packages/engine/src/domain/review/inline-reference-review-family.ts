import { canonicalJson, compareCausalOrder, type FactAction } from "../fact/index.js";
import { locateInlineReference, type InterpretedProjectionGeneration } from "../reconcile/index.js";
import type { HunkCandidate, ReviewFamilyRule } from "./review-family.js";
import { associatedNodeScope, reviewScope } from "./review-scope.js";
import type { InlineReferenceDecisionEffect, InlineReferenceDecisionState } from "./types.js";

const INLINE_REFERENCE_ACTION_KINDS = [
  "inline-reference-create",
  "inline-reference-remove",
  "inline-alias-attach",
  "inline-alias-detach",
] as const;

export const inlineReferenceReviewFamily = {
  key: "inline-reference",
  actionKinds: INLINE_REFERENCE_ACTION_KINDS,
  scopes(fact) {
    const action = fact.action;
    return [
      reviewScope("inline-reference", action.inlineReferenceId),
      ...(action.kind === "inline-reference-create"
        ? [associatedNodeScope(action.hostNodeId), associatedNodeScope(action.targetNodeId)]
        : action.kind === "inline-reference-remove"
          ? []
          : [associatedNodeScope(action.aliasNodeId)]),
    ];
  },
  candidates: ({ generation, pending }) => inlineReferenceCandidates(generation, pending),
  effect(fact, _targets, generation) {
    const action = fact.action;
    const effect = inlineReferenceEffect(action.inlineReferenceId, generation);
    return canonicalJson(effect.origin) === canonicalJson(effect.review)
      ? null
      : { identity: `inline-reference/${action.inlineReferenceId}`, effect };
  },
  addImpacts(impacts, targets, generation) {
    for (const fact of targets) {
      const action = fact.action;
      if (!isInlineReferenceAction(action)) {
        continue;
      }
      impacts.add(action.inlineReferenceId);
      const effect = inlineReferenceEffect(action.inlineReferenceId, generation);
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
} satisfies ReviewFamilyRule<(typeof INLINE_REFERENCE_ACTION_KINDS)[number]>;

function inlineReferenceCandidates(
  generation: InterpretedProjectionGeneration,
  pending: ReadonlyMap<FactAction["id"], FactAction>,
): readonly HunkCandidate[] {
  const groups = new Map<string, FactAction[]>();
  for (const fact of pending.values()) {
    const action = fact.action;
    if (!isInlineReferenceAction(action)) {
      continue;
    }
    const values = groups.get(action.inlineReferenceId) ?? [];
    values.push(fact);
    groups.set(action.inlineReferenceId, values);
  }
  return [...groups].flatMap(([inlineReferenceId, facts]) => {
    const effect = inlineReferenceEffect(inlineReferenceId, generation);
    return canonicalJson(effect.origin) === canonicalJson(effect.review)
      ? []
      : [
          {
            diffSpace: { kind: "inline-reference" as const, identity: inlineReferenceId },
            targets: [...facts].sort(compareCausalOrder).map((fact) => fact.id),
            bridges: [],
          },
        ];
  });
}

function inlineReferenceEffect(
  inlineReferenceId: string,
  generation: InterpretedProjectionGeneration,
): InlineReferenceDecisionEffect {
  return {
    kind: "inline-reference",
    inlineReferenceId,
    origin: stateFor(generation.origin.nodes, inlineReferenceId),
    review: stateFor(generation.review.nodes, inlineReferenceId),
  };
}

function stateFor(
  nodes: InterpretedProjectionGeneration["origin"]["nodes"],
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

function isInlineReferenceAction(action: FactAction["action"]): action is Extract<
  FactAction["action"],
  {
    kind: "inline-reference-create" | "inline-reference-remove" | "inline-alias-attach" | "inline-alias-detach";
  }
> {
  return INLINE_REFERENCE_ACTION_KINDS.includes(action.kind as (typeof INLINE_REFERENCE_ACTION_KINDS)[number]);
}
