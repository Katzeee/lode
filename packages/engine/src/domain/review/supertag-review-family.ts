import { canonicalJson, isSupertagAction, proposableActionKindsInFamily } from "../fact/index.js";
import { addNodeReviewImpacts } from "./review-node-impact.js";
import { defineReviewFamily } from "./review-family.js";
import { addSupertagRelationImpacts, supertagRelationAddress, supertagRelationEffect } from "./supertag-review.js";
import { associatedNodeScope, reviewScope } from "./review-scope.js";
import type { SupertagRelationDecisionEffect } from "./types.js";

const ACTION_KINDS = proposableActionKindsInFamily("supertag");

export const supertagReviewFamily = defineReviewFamily<
  (typeof ACTION_KINDS)[number],
  string,
  SupertagRelationDecisionEffect
>({
  key: "supertag",
  actionKinds: ACTION_KINDS,
  scopes(fact) {
    const action = fact.action;
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
  identify: (fact, generation) => supertagRelationAddress(fact.action, generation),
  effect: (fact, _identity, generation) => supertagRelationEffect(fact, generation),
  changed: (effect) => effect.originIndex !== effect.reviewIndex,
  diffKind: (effect) => (effect.relation === "application" ? "supertag-application" : "supertag-template"),
  effectIdentity: (_identity, effect) =>
    canonicalJson(["supertag-relation", effect.relation, effect.ownerId, effect.targetId]),
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
});
