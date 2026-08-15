import { addNodeReviewImpacts } from "./review-node-impact.js";
import type { ReviewFamilyRule } from "./review-family.js";
import { associatedNodeScope, reviewScope } from "./review-scope.js";
import { textCandidates } from "./text-review-candidates.js";
import { hasTextEffect, isTextMutation, textEffect } from "./text-review-effect.js";

const TEXT_MUTATION_KINDS = ["text-splice", "text-mark"] as const;

export const textReviewFamily = {
  key: "text",
  mutationKinds: TEXT_MUTATION_KINDS,
  scopes(fact) {
    const mutation = fact.body.mutation;
    if (!isTextMutation(mutation)) {
      throw new Error("Text Review family received another Mutation family");
    }
    return [reviewScope("node-content", mutation.nodeId), associatedNodeScope(mutation.nodeId)];
  },
  candidates: ({ snapshot, generation, pending }) => textCandidates(snapshot, generation, pending),
  effect(fact, targets, generation) {
    const mutation = fact.body.mutation;
    if (!isTextMutation(mutation)) {
      throw new Error("Text Review family received another Mutation family");
    }
    const textTargets = targets.filter(
      (target) => isTextMutation(target.body.mutation) && target.body.mutation.nodeId === mutation.nodeId,
    );
    const effect = textEffect(mutation.nodeId, textTargets, generation);
    return hasTextEffect(effect) ? { identity: `text/${mutation.nodeId}`, effect } : null;
  },
  addImpacts(impacts, targets, generation) {
    for (const fact of targets) {
      const mutation = fact.body.mutation;
      if (isTextMutation(mutation)) {
        addNodeReviewImpacts(impacts, mutation.nodeId, generation);
      }
    }
  },
} satisfies ReviewFamilyRule;
