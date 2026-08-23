import { canonicalJson, isSupertagAction, type AuthoredAction } from "../fact/index.js";
import { addNodeReviewImpacts } from "./review-node-impact.js";
import type { ReviewFamilyRule } from "./review-family.js";
import { supertagCandidates } from "./supertag-candidates.js";
import { addSupertagRelationImpacts, supertagRelationEffect } from "./supertag-review.js";
import { associatedNodeScope, reviewScope } from "./review-scope.js";

const ACTION_KINDS = [
  "supertag-application-add",
  "supertag-membership-remove",
  "supertag-extension-add",
  "supertag-extension-remove",
  "template-member-add",
  "template-member-remove",
  "template-field-add",
  "template-field-remove",
  "template-field-restore",
  "template-field-visibility-set",
  "template-field-static-default-set",
  "optional-field-contribution-add",
  "optional-field-contribution-remove",
] as const;

export const supertagReviewFamily = {
  key: "supertag",
  actionKinds: ACTION_KINDS,
  scopes(fact) {
    const action = fact.action;
    if (!isSupertagReviewAction(action)) {
      throw new Error("Supertag Review family received another AuthoredAction family");
    }
    if (action.kind === "supertag-application-add" || action.kind === "supertag-membership-remove") {
      return [
        reviewScope("supertag-application", action.hostNodeId, action.supertagId),
        associatedNodeScope(action.hostNodeId),
        associatedNodeScope(action.supertagId),
      ];
    }
    if (action.kind === "supertag-extension-add" || action.kind === "supertag-extension-remove") {
      return [
        reviewScope("supertag-extension", action.supertagId, action.baseSupertagId),
        associatedNodeScope(action.supertagId),
        associatedNodeScope(action.baseSupertagId),
      ];
    }
    if (action.kind === "template-member-add" || action.kind === "template-member-remove") {
      return [
        reviewScope("supertag-template", action.supertagId),
        associatedNodeScope(action.supertagId),
        associatedNodeScope(action.templateNodeId),
      ];
    }
    if (action.kind === "template-field-add") {
      return [
        reviewScope("template-field", action.supertagId, action.fieldDefinition.fieldDefinitionId),
        associatedNodeScope(action.supertagId),
        associatedNodeScope(action.fieldDefinition.fieldDefinitionId),
      ];
    }
    if (
      action.kind === "template-field-restore" ||
      action.kind === "template-field-visibility-set" ||
      action.kind === "template-field-static-default-set"
    ) {
      return [reviewScope("template-field", action.templateFieldId)];
    }
    return [
      reviewScope("supertag-template", action.supertagId),
      associatedNodeScope(action.supertagId),
      associatedNodeScope(action.fieldDefinitionId),
    ];
  },
  candidates: ({ generation, pending }) => supertagCandidates(generation, pending),
  effect(fact, _targets, generation) {
    if (!isSupertagAction(fact.action)) {
      throw new Error("Supertag Review family received another AuthoredAction family");
    }
    const effect = supertagRelationEffect(fact, generation);
    return effect.originIndex === effect.reviewIndex
      ? null
      : { identity: canonicalJson(["supertag-relation", effect.relation, effect.ownerId, effect.targetId]), effect };
  },
  addImpacts(impacts, targets, generation) {
    for (const fact of targets) {
      if (!isSupertagAction(fact.action)) {
        continue;
      }
      if (fact.action.kind === "supertag-application-add" || fact.action.kind === "supertag-membership-remove") {
        addNodeReviewImpacts(impacts, fact.action.hostNodeId, generation);
      }
      addSupertagRelationImpacts(impacts, fact, generation);
    }
  },
} satisfies ReviewFamilyRule;

function isSupertagReviewAction(
  action: AuthoredAction,
): action is Extract<AuthoredAction, { kind: (typeof ACTION_KINDS)[number] }> {
  return ACTION_KINDS.includes(action.kind as (typeof ACTION_KINDS)[number]);
}
