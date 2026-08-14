import { canonicalJson, isSchemaMutation } from "../fact/index.js";
import { addNodeReviewImpacts } from "./review-node-impact.js";
import type { ReviewFamilyRule } from "./review-family.js";
import { fieldConfigurationEffect, schemaCandidates } from "./schema-candidates.js";
import { addSchemaRelationImpacts, schemaRelationEffect } from "./schema-review.js";

const SCHEMA_REVIEW_MUTATION_KINDS = [
  "schema-apply",
  "schema-remove",
  "schema-field-add",
  "schema-field-remove",
  "schema-field-configure",
  "schema-extension-add",
  "schema-extension-remove",
  "schema-template-node-add",
  "schema-template-node-remove",
] as const;

export const schemaReviewFamily = {
  key: "schema",
  mutationKinds: SCHEMA_REVIEW_MUTATION_KINDS,
  candidates: ({ generation, pending }) => schemaCandidates(generation, pending),
  effect(fact, _targets, generation) {
    const mutation = fact.body.mutation;
    if (mutation.kind === "schema-field-configure") {
      const effect = fieldConfigurationEffect(fact, generation);
      return canonicalJson(effect.origin) === canonicalJson(effect.review)
        ? null
        : {
            identity: canonicalJson([
              "field-configuration",
              effect.schemaId,
              effect.fieldDefinitionId,
            ]),
            effect,
          };
    }
    if (isSchemaMutation(mutation)) {
      const effect = schemaRelationEffect(fact, generation);
      return effect.originIndex === effect.reviewIndex
        ? null
        : {
            identity: canonicalJson([
              "schema-relation",
              effect.relation,
              effect.ownerId,
              effect.targetId,
            ]),
            effect,
          };
    }
    throw new Error("Schema Review family received another Mutation family");
  },
  addImpacts(impacts, targets, generation) {
    for (const fact of targets) {
      const mutation = fact.body.mutation;
      if (mutation.kind === "schema-apply" || mutation.kind === "schema-remove") {
        addNodeReviewImpacts(impacts, mutation.nodeId, generation);
      }
      addSchemaRelationImpacts(impacts, fact, generation);
    }
  },
} satisfies ReviewFamilyRule;
