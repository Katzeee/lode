import { isReplicaId, type ProjectionIdentity, type ProjectionPerspective } from "../../../../domain/fact/index.js";
import type { ProjectionGeneration } from "../../../../domain/reconcile/index.js";
import type { MaterializedDataset, MaterializedDatasetEntry } from "./store/materialized-dataset.js";
import { defineMaterializedDataset, materializedDatasetEntry } from "./store/materialized-dataset.js";
import {
  isProjectionLookupIndexSection,
  isProjectionLookupIndexValue,
  projectionLookupIndexEntries,
} from "./materialized-projection-index.js";
import {
  isMaterializedProjectionValue,
  materializedProjectionEntries,
} from "./materialized-projection-section-codec.js";
import { hasExactKeys, isRecord } from "../../../../decoding/index.js";
import { PROJECTION_SLICE_NAMES, type ProjectionSliceName, type ProjectionSliceValue } from "./projection-slices.js";

const PROJECTION_DATASET = "projection";
const PLAN_CACHE_PARTITION = "generation";
const PLAN_CACHE_SECTION = "planCaches";
const PLAN_CACHE_IDENTITY = "value";

export const PROJECTION_MATERIALIZED_DATASETS = (["origin", "review"] as const).flatMap((perspective) =>
  PROJECTION_SLICE_NAMES.map((section) => projectionMaterializedDataset(perspective, section)),
);

export const planCacheMaterializedDataset = defineMaterializedDataset<ProjectionGeneration["planCaches"]>(
  {
    dataset: PROJECTION_DATASET,
    partition: PLAN_CACHE_PARTITION,
    section: PLAN_CACHE_SECTION,
  },
  (identity, value): value is ProjectionGeneration["planCaches"] =>
    identity === PLAN_CACHE_IDENTITY && isPlanCaches(value),
);

export function projectionMaterializedEntries(generation: ProjectionGeneration): readonly MaterializedDatasetEntry[] {
  const entries = [generation.origin, generation.review].flatMap((projection) =>
    [...materializedProjectionEntries(projection), ...projectionLookupIndexEntries(projection)].map((entry) => ({
      ...projectionMaterializedDataset(projection.perspective, entry.section).root,
      identity: entry.identity,
      value: entry.value,
    })),
  );
  return [
    ...entries,
    materializedDatasetEntry(planCacheMaterializedDataset, PLAN_CACHE_IDENTITY, generation.planCaches),
  ];
}

export function projectionMaterializedDataset<Section extends ProjectionSliceName>(
  perspective: ProjectionPerspective,
  section: Section,
): MaterializedDataset<ProjectionSliceValue<Section>> {
  return defineMaterializedDataset(
    { dataset: PROJECTION_DATASET, partition: perspective, section },
    (identity, value): value is ProjectionSliceValue<Section> =>
      isProjectionLookupIndexSection(section)
        ? isProjectionLookupIndexValue(section, value)
        : isMaterializedProjectionValue(section, identity, value),
  );
}

export function isProjectionIdentity(value: unknown, generationId: string): value is ProjectionIdentity {
  if (
    !hasExactKeys(value, ["workspaceNodeId", "generationId", "frontier", "rulesVersion", "schemaVersion"]) ||
    typeof value.workspaceNodeId !== "string" ||
    value.generationId !== generationId ||
    typeof value.rulesVersion !== "string" ||
    typeof value.schemaVersion !== "string" ||
    !isRecord(value.frontier)
  ) {
    return false;
  }
  return Object.entries(value.frontier).every(
    ([replicaId, sequence]) => isReplicaId(replicaId) && Number.isSafeInteger(sequence) && (sequence as number) >= 0,
  );
}

function isPlanCaches(value: unknown): boolean {
  if (!hasExactKeys(value, ["origin", "review"])) {
    return false;
  }
  return [value.origin, value.review].every(
    (cache) =>
      hasExactKeys(cache, ["activeActionIds", "supportByAction"]) &&
      Array.isArray(cache.activeActionIds) &&
      cache.activeActionIds.every((id) => typeof id === "string") &&
      isStringArrayRecord(cache.supportByAction),
  );
}

function isStringArrayRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => Array.isArray(entry) && entry.every((item) => typeof item === "string"))
  );
}
