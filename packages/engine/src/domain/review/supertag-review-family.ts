import { canonicalJson, isSupertagMutation, type Mutation } from "../fact/index.js";
import { addNodeReviewImpacts } from "./review-node-impact.js";
import type { ReviewFamilyRule } from "./review-family.js";
import { fieldConfigurationEffect, supertagCandidates } from "./supertag-candidates.js";
import { addSupertagRelationImpacts, supertagRelationEffect } from "./supertag-review.js";
import { associatedNodeScope, reviewScope } from "./review-scope.js";

const SCHEMA_REVIEW_MUTATION_KINDS = [
  "supertag-apply",
  "supertag-remove",
  "supertag-field-add",
  "supertag-field-remove",
  "supertag-field-configure",
  "supertag-extension-add",
  "supertag-extension-remove",
  "supertag-template-node-add",
  "supertag-template-node-remove",
] as const;

export const supertagReviewFamily = {
  key: "supertag",
  mutationKinds: SCHEMA_REVIEW_MUTATION_KINDS,
  scopes(fact) {
    const mutation = fact.body.mutation;
    if (!isSupertagReviewMutation(mutation)) {
      throw new Error("Supertag Review family received another Mutation family");
    }
    switch (mutation.kind) {
      case "supertag-apply":
      case "supertag-remove":
        return [
          reviewScope("supertag-application", mutation.nodeId),
          associatedNodeScope(mutation.nodeId),
          associatedNodeScope(mutation.supertagId),
        ];
      case "supertag-field-add":
      case "supertag-field-remove":
      case "supertag-field-configure":
        return [
          reviewScope("supertag-template", mutation.supertagId),
          associatedNodeScope(mutation.supertagId),
          associatedNodeScope(mutation.fieldDefinitionId),
        ];
      case "supertag-extension-add":
      case "supertag-extension-remove":
        return [
          reviewScope("supertag-extension", mutation.supertagId),
          associatedNodeScope(mutation.supertagId),
          associatedNodeScope(mutation.baseSupertagId),
        ];
      case "supertag-template-node-add":
      case "supertag-template-node-remove":
        return [
          reviewScope("supertag-template", mutation.supertagId),
          associatedNodeScope(mutation.supertagId),
          associatedNodeScope(mutation.templateNodeId),
        ];
    }
  },
  candidates: ({ generation, pending }) => supertagCandidates(generation, pending),
  effect(fact, _targets, generation) {
    const mutation = fact.body.mutation;
    if (mutation.kind === "supertag-field-configure") {
      const effect = fieldConfigurationEffect(fact, generation);
      return canonicalJson(effect.origin) === canonicalJson(effect.review)
        ? null
        : {
            identity: canonicalJson(["field-configuration", effect.supertagId, effect.fieldDefinitionId]),
            effect,
          };
    }
    if (isSupertagMutation(mutation)) {
      const effect = supertagRelationEffect(fact, generation);
      return effect.originIndex === effect.reviewIndex
        ? null
        : {
            identity: canonicalJson(["supertag-relation", effect.relation, effect.ownerId, effect.targetId]),
            effect,
          };
    }
    throw new Error("Supertag Review family received another Mutation family");
  },
  addImpacts(impacts, targets, generation) {
    for (const fact of targets) {
      const mutation = fact.body.mutation;
      if (mutation.kind === "supertag-apply" || mutation.kind === "supertag-remove") {
        addNodeReviewImpacts(impacts, mutation.nodeId, generation);
      }
      addSupertagRelationImpacts(impacts, fact, generation);
    }
  },
} satisfies ReviewFamilyRule;

function isSupertagReviewMutation(
  mutation: Mutation,
): mutation is Extract<Mutation, { kind: (typeof SCHEMA_REVIEW_MUTATION_KINDS)[number] }> {
  return SCHEMA_REVIEW_MUTATION_KINDS.includes(mutation.kind as (typeof SCHEMA_REVIEW_MUTATION_KINDS)[number]);
}
