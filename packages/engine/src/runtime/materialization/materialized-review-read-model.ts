import type { ReviewReadModel } from "../../domain/review/index.js";
import { isStringArray } from "./materialized-validation-primitives.js";

export const REVIEW_READ_MODEL_SECTION_NAMES = ["reviewScopes", "reviewSupport"] as const;

export type ReviewReadModelSection = (typeof REVIEW_READ_MODEL_SECTION_NAMES)[number];

export function isReviewReadModelSection(section: string): section is ReviewReadModelSection {
  return REVIEW_READ_MODEL_SECTION_NAMES.includes(section as ReviewReadModelSection);
}

export function materializedReviewReadModelEntries(model: ReviewReadModel): readonly Readonly<{
  section: ReviewReadModelSection;
  identity: string;
  value: readonly string[];
}>[] {
  return [
    ...Object.entries(model.scopes).map(([identity, value]) => ({
      section: "reviewScopes" as const,
      identity,
      value,
    })),
    ...Object.entries(model.supportByContribution).map(([identity, value]) => ({
      section: "reviewSupport" as const,
      identity,
      value,
    })),
  ];
}

export function isReviewReadModelValue(value: unknown): value is readonly string[] {
  return isStringArray(value);
}
