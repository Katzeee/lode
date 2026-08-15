import type { ProjectionIdentity } from "../../domain/fact/index.js";
import { materializedDatasetCatalog } from "./materialized-dataset.js";
import { REVIEW_MATERIALIZED_DATASETS } from "./materialized-review-read-model.js";
import {
  isProjectionIdentity,
  planCacheMaterializedDataset,
  PROJECTION_MATERIALIZED_DATASETS,
} from "./projection-materialized-dataset.js";

export const MATERIALIZED_DATASETS = materializedDatasetCatalog<ProjectionIdentity>(
  [...PROJECTION_MATERIALIZED_DATASETS, planCacheMaterializedDataset, ...REVIEW_MATERIALIZED_DATASETS],
  isProjectionIdentity,
);
