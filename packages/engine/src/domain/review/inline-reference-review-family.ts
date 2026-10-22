import { isInlineReferenceAction, proposableActionKindsInFamily } from "../fact/index.js";
import { locateInlineReference, type InterpretedProjectionGeneration } from "../reconcile/index.js";
import { defineReviewFamily, originReviewChanged } from "./review-family.js";
import { associatedNodeScope, reviewScope } from "./review-scope.js";
import type { InlineReferenceDecisionEffect, InlineReferenceDecisionState } from "./types.js";

const INLINE_REFERENCE_ACTION_KINDS = proposableActionKindsInFamily("inlineReference");

export const inlineReferenceReviewFamily = defineReviewFamily<
  (typeof INLINE_REFERENCE_ACTION_KINDS)[number],
  string,
  InlineReferenceDecisionEffect
>({
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
  identify: (fact) => fact.action.inlineReferenceId,
  effect: (_fact, inlineReferenceId, generation) => inlineReferenceEffect(inlineReferenceId, generation),
  changed: originReviewChanged,
  diffKind: "inline-reference",
  effectIdentity: (inlineReferenceId) => `inline-reference/${inlineReferenceId}`,
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
});

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
