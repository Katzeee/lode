import { isTextAction, proposableActionKindsInFamily } from "../fact/index.js";
import { addNodeReviewImpacts } from "./review-node-impact.js";
import type { ReviewFamilyRule } from "./review-family.js";
import { associatedNodeScope, reviewScope } from "./review-scope.js";
import { textCandidates } from "./text-review-candidates.js";
import { hasTextEffect, isTextFactAction, textEffect } from "./text-review-effect.js";

const TEXT_ACTION_KINDS = proposableActionKindsInFamily("text");

export const textReviewFamily = {
  key: "text",
  actionKinds: TEXT_ACTION_KINDS,
  scopes(fact) {
    const action = fact.action;
    return [reviewScope("node-content", action.nodeId), associatedNodeScope(action.nodeId)];
  },
  candidates: ({ snapshot, generation, pending }) => textCandidates(snapshot, generation, pending),
  effect(fact, targets, generation) {
    const action = fact.action;
    const textTargets = targets.filter(isTextFactAction).filter((target) => target.action.nodeId === action.nodeId);
    const effect = textEffect(action.nodeId, textTargets, generation);
    return hasTextEffect(effect) ? { identity: `text/${action.nodeId}`, effect } : null;
  },
  addImpacts(impacts, targets, generation) {
    for (const fact of targets) {
      const action = fact.action;
      if (isTextAction(action)) {
        addNodeReviewImpacts(impacts, action.nodeId, generation);
      }
    }
  },
} satisfies ReviewFamilyRule<(typeof TEXT_ACTION_KINDS)[number]>;
