import type { ReviewReadModel } from "../../../../domain/review/index.js";
import type { MaterializedDataset, MaterializedDatasetEntry } from "./store/materialized-dataset.js";
import { defineMaterializedDataset, materializedDatasetEntry } from "./store/materialized-dataset.js";
import { isStringArray } from "../../../../decoding/index.js";
import { isFactActionId, type FactActionId } from "../../../../domain/fact/index.js";

const REVIEW_READ_MODEL_SECTION_NAMES = ["scopes", "support"] as const;

type ReviewReadModelSection = (typeof REVIEW_READ_MODEL_SECTION_NAMES)[number];

function isReviewReadModelValue(value: unknown): value is readonly FactActionId[] {
  return isStringArray(value) && value.every(isFactActionId);
}

export const REVIEW_MATERIALIZED_DATASETS = REVIEW_READ_MODEL_SECTION_NAMES.map((section) =>
  reviewMaterializedDataset(section),
);

export function reviewReadModelEntries(model: ReviewReadModel): readonly MaterializedDatasetEntry[] {
  return [
    ...Object.entries(model.scopes).map(([identity, value]) =>
      materializedDatasetEntry(reviewMaterializedDataset("scopes"), identity, value),
    ),
    ...Object.entries(model.supportByAction).map(([identity, value]) =>
      materializedDatasetEntry(reviewMaterializedDataset("support"), identity, value),
    ),
  ];
}

export function reviewMaterializedDataset(
  section: ReviewReadModelSection,
): MaterializedDataset<readonly FactActionId[]> {
  return defineMaterializedDataset(
    { dataset: "review", partition: "read-model", section },
    (_identity, value): value is readonly FactActionId[] => isReviewReadModelValue(value),
  );
}
