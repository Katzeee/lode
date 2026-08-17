import { canonicalJson, isSupertagMutation, type Mutation } from "../fact/index.js";
import { addNodeReviewImpacts } from "./review-node-impact.js";
import type { ReviewFamilyRule } from "./review-family.js";
import { supertagCandidates } from "./supertag-candidates.js";
import { addSupertagRelationImpacts, supertagRelationEffect } from "./supertag-review.js";
import { associatedNodeScope, reviewScope } from "./review-scope.js";

const SCHEMA_REVIEW_MUTATION_KINDS = [
  "supertag-apply",
  "supertag-remove",
  "supertag-extension-add",
  "supertag-extension-remove",
  "supertag-template-node-add",
  "supertag-template-node-remove",
  "supertag-template-field-attach",
  "supertag-template-field-existing-attach",
  "supertag-template-field-detach",
  "supertag-template-field-discoverability-set",
  "supertag-template-field-visibility-configure",
  "supertag-optional-field-contribution-attach",
  "supertag-optional-field-contribution-detach",
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
          reviewScope("supertag-application", mutation.applicationNodeId),
          associatedNodeScope(mutation.hostNodeId),
          associatedNodeScope(mutation.applicationNodeId),
          associatedNodeScope(mutation.supertagId),
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
      case "supertag-template-field-attach":
      case "supertag-template-field-existing-attach":
      case "supertag-template-field-detach":
      case "supertag-template-field-discoverability-set":
      case "supertag-template-field-visibility-configure":
        return [
          reviewScope("supertag-template", mutation.supertagId),
          associatedNodeScope(mutation.supertagId),
          associatedNodeScope(mutation.templateFieldNodeId),
          associatedNodeScope(mutation.fieldDefinitionId),
        ];
      case "supertag-optional-field-contribution-attach":
      case "supertag-optional-field-contribution-detach":
        return [
          reviewScope("supertag-template", mutation.supertagId),
          associatedNodeScope(mutation.supertagId),
          associatedNodeScope(mutation.contributionNodeId),
          associatedNodeScope(mutation.fieldDefinitionId),
        ];
    }
  },
  candidates: ({ generation, pending }) => supertagCandidates(generation, pending),
  effect(fact, _targets, generation) {
    const mutation = fact.body.mutation;
    if (isSupertagMutation(mutation)) {
      if (
        mutation.kind === "supertag-template-field-attach" ||
        mutation.kind === "supertag-template-field-existing-attach" ||
        mutation.kind === "supertag-template-field-detach" ||
        mutation.kind === "supertag-template-field-discoverability-set" ||
        mutation.kind === "supertag-optional-field-contribution-attach" ||
        mutation.kind === "supertag-optional-field-contribution-detach"
      ) {
        return null;
      }
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
        addNodeReviewImpacts(impacts, mutation.hostNodeId, generation);
        impacts.add(mutation.applicationNodeId);
      }
      if (
        mutation.kind === "supertag-apply" ||
        mutation.kind === "supertag-remove" ||
        mutation.kind === "supertag-extension-add" ||
        mutation.kind === "supertag-extension-remove" ||
        mutation.kind === "supertag-template-node-add" ||
        mutation.kind === "supertag-template-node-remove"
      ) {
        addSupertagRelationImpacts(impacts, fact, generation);
      }
    }
  },
} satisfies ReviewFamilyRule;

function isSupertagReviewMutation(
  mutation: Mutation,
): mutation is Extract<Mutation, { kind: (typeof SCHEMA_REVIEW_MUTATION_KINDS)[number] }> {
  return SCHEMA_REVIEW_MUTATION_KINDS.includes(mutation.kind as (typeof SCHEMA_REVIEW_MUTATION_KINDS)[number]);
}
