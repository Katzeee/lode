import type { ReviewFamilyRule } from "./review-family.js";

export const configurationReviewFamily = {
  key: "configuration",
  mutationKinds: ["metanode-attach", "search-expression-attach", "search-expression-detach"],
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
