import type { ReviewReadModel } from "../../../../domain/review/index.js";
import type { MaterializedDataset, MaterializedDatasetEntry } from "./store/materialized-dataset.js";
import { defineMaterializedDataset, materializedDatasetEntry } from "./store/materialized-dataset.js";
import { isStringArray } from "../../../../decoding/index.js";

export const REVIEW_READ_MODEL_SECTION_NAMES = ["scopes", "support"] as const;

export type ReviewReadModelSection = (typeof REVIEW_READ_MODEL_SECTION_NAMES)[number];

export function isReviewReadModelValue(value: unknown): value is readonly string[] {
  return isStringArray(value);
}

export const REVIEW_MATERIALIZED_DATASETS = REVIEW_READ_MODEL_SECTION_NAMES.map((section) =>
  reviewMaterializedDataset(section),
);

export function reviewReadModelEntries(model: ReviewReadModel): readonly MaterializedDatasetEntry[] {
  return [
    ...Object.entries(model.scopes).map(([identity, value]) =>
      materializedDatasetEntry(reviewMaterializedDataset("scopes"), identity, value),
    ),
    ...Object.entries(model.supportByContribution).map(([identity, value]) =>
      materializedDatasetEntry(reviewMaterializedDataset("support"), identity, value),
    ),
  ];
}

export function reviewMaterializedDataset(section: ReviewReadModelSection): MaterializedDataset<readonly string[]> {
  return defineMaterializedDataset(
    { dataset: "review", partition: "read-model", section },
    (_identity, value): value is readonly string[] => isReviewReadModelValue(value),
  );
}
