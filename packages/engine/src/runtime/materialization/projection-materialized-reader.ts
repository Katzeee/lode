import type { ProjectionIdentity, ViewMode } from "../../domain/fact/index.js";
import type { ProjectionGeneration, ProjectionSectionName } from "../../domain/reconcile/index.js";
import type { MaterializedGenerationRead } from "./bounded-materialized-store.js";
import { loadMaterializedProjection } from "./materialized-projection-loader.js";
import type { ProjectionShardBatch, ProjectionSliceName, ProjectionSlicePage } from "./projection-slices.js";
import {
  planCacheMaterializedDataset,
  projectionMaterializedDataset,
  PROJECTION_MATERIALIZED_DATASETS,
} from "./projection-materialized-dataset.js";

export async function loadProjectionGeneration(
  generation: MaterializedGenerationRead<ProjectionIdentity>,
): Promise<ProjectionGeneration> {
  const entries = (
    await Promise.all(PROJECTION_MATERIALIZED_DATASETS.map((dataset) => generation.all(dataset)))
  ).flat();
  const projectionEntries = (view: ViewMode) => entries.filter((entry) => entry.descriptor.partition === view);
  const planCaches = (await generation.all(planCacheMaterializedDataset))[0];
  if (!planCaches) {
    throw new Error("Published Projection plan cache is absent");
  }
  return {
    identity: generation.identity,
    origin: loadMaterializedProjection("origin", generation.identity, projectionEntries("origin")),
    review: loadMaterializedProjection("review", generation.identity, projectionEntries("review")),
    planCaches: planCaches.value,
  };
}

export async function readProjectionSectionPage<Section extends ProjectionSectionName>(
  generation: MaterializedGenerationRead<ProjectionIdentity>,
  view: ViewMode,
  section: Section,
  after: string | null,
  limit: number,
): Promise<ProjectionSlicePage<Section>> {
  const page = await generation.page(projectionMaterializedDataset(view, section), after, limit);
  return {
    identity: generation.identity,
    next: page.hasMore ? (page.entries.at(-1)?.descriptor.identity ?? null) : null,
    entries: page.entries.map((entry) => ({
      identity: entry.descriptor.identity,
      value: entry.value,
    })),
  };
}

export async function readProjectionSlice<Section extends ProjectionSliceName>(
  generation: MaterializedGenerationRead<ProjectionIdentity>,
  view: ViewMode,
  section: Section,
  identities: readonly string[],
): Promise<ProjectionShardBatch<Section>> {
  const selected = await generation.exact(projectionMaterializedDataset(view, section), identities);
  return {
    identity: generation.identity,
    entries: selected.map((entry) => ({
      identity: entry.descriptor.identity,
      value: entry.value,
    })),
  };
}

export async function readProjectionSchemaSearch(
  generation: MaterializedGenerationRead<ProjectionIdentity>,
  view: ViewMode,
  schemaId: string,
  after: string | null,
  limit: number,
) {
  const prefix = `${encodeURIComponent(schemaId)}/`;
  const page = await generation.page(
    projectionMaterializedDataset(view, "schemaInstanceMemberships"),
    after === null ? prefix : `${prefix}${encodeURIComponent(after)}`,
    limit + 1,
  );
  const matches = page.entries.filter((entry) => entry.descriptor.identity.startsWith(prefix));
  const selected = matches.slice(0, limit);
  const nodeIds = selected.map((entry) => entry.value);
  return {
    identity: generation.identity,
    nodeIds,
    next: matches.length > selected.length ? (nodeIds.at(-1) ?? null) : null,
  };
}
