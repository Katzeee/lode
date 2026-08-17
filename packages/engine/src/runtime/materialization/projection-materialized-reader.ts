import type { ProjectionIdentity, ProjectionPerspective } from "../../domain/fact/index.js";
import type { ProjectionGeneration, ProjectionSectionName } from "../../domain/reconcile/index.js";
import { evaluateSearchExpressionSpec } from "../../domain/query/index.js";
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
  const projectionEntries = (perspective: ProjectionPerspective) =>
    entries.filter((entry) => entry.descriptor.partition === perspective);
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
  perspective: ProjectionPerspective,
  section: Section,
  after: string | null,
  limit: number,
): Promise<ProjectionSlicePage<Section>> {
  const page = await generation.page(projectionMaterializedDataset(perspective, section), after, limit);
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
  perspective: ProjectionPerspective,
  section: Section,
  identities: readonly string[],
): Promise<ProjectionShardBatch<Section>> {
  const selected = await generation.exact(projectionMaterializedDataset(perspective, section), identities);
  return {
    identity: generation.identity,
    entries: selected.map((entry) => ({
      identity: entry.descriptor.identity,
      value: entry.value,
    })),
  };
}

export async function readProjectionSupertagInstances(
  generation: MaterializedGenerationRead<ProjectionIdentity>,
  perspective: ProjectionPerspective,
  supertagId: string,
  after: string | null,
  limit: number,
) {
  const projectionGeneration = await loadProjectionGeneration(generation);
  const projection = projectionGeneration[perspective];
  const matches = evaluateSearchExpressionSpec(
    { expressionNodeId: `supertag-page:${supertagId}`, kind: "supertag", supertagId },
    projection,
  );
  const nextIndex = after === null ? 0 : matches.findIndex((nodeId) => nodeId > after);
  const start = nextIndex < 0 ? matches.length : nextIndex;
  const nodeIds = matches.slice(start, start + limit);
  return {
    identity: generation.identity,
    nodeIds,
    next: start + limit < matches.length ? (nodeIds.at(-1) ?? null) : null,
  };
}
