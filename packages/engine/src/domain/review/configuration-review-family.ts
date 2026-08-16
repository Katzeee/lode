import type { ReviewFamilyRule } from "./review-family.js";

export const configurationReviewFamily = {
  key: "configuration",
  mutationKinds: ["metanode-attach", "search-supertag-clause-attach", "search-field-clause-attach"],
  scopes() {
    return [];
  },
  candidates() {
    return [];
  },
  effect() {
    return null;
  },
  addImpacts() {},
} satisfies ReviewFamilyRule;
