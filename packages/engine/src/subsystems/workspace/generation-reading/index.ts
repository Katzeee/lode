import type { EditAction } from "../../../domain/edit/index.js";
import type { FactAction, ProjectionPerspective } from "../../../domain/fact/index.js";
import type { ScopedProjection, ScopedProjectionGeneration } from "../../../domain/reconcile/index.js";
import type { ProjectionSnapshotReader } from "../projection/index.js";
import { planEditGenerationRead, planFactActionGenerationRead, type GenerationReadPlan } from "./read-plan.js";
import { planProjectionScopeGenerationRead } from "./projection-scope-read-plan.js";
import { readResolvedProjection } from "./projection-reader.js";
import { resolveGenerationRead } from "./scope-resolver.js";

export function readFactActionGeneration(
  store: ProjectionSnapshotReader,
  generationId: string,
  facts: readonly FactAction[],
): Promise<ScopedProjectionGeneration> {
  return readScopedGeneration(store, generationId, planFactActionGenerationRead(facts));
}

export function readEditGeneration(
  store: ProjectionSnapshotReader,
  generationId: string,
  edits: readonly EditAction[],
): Promise<ScopedProjectionGeneration> {
  return readScopedGeneration(store, generationId, planEditGenerationRead(edits));
}

export function readProjectionScopeGeneration(
  store: ProjectionSnapshotReader,
  generationId: string,
  nodeIds: readonly string[],
  readsOwnerGraph: boolean,
  readsOwnedDescendants: boolean,
): Promise<ScopedProjectionGeneration> {
  return readScopedGeneration(
    store,
    generationId,
    planProjectionScopeGenerationRead(nodeIds, readsOwnerGraph, readsOwnedDescendants),
  );
}

async function readScopedGeneration(
  store: ProjectionSnapshotReader,
  generationId: string,
  plan: GenerationReadPlan,
): Promise<ScopedProjectionGeneration> {
  const origin = await readView(store, generationId, "origin", plan);
  const review = await readView(store, generationId, "review", plan);
  return { identity: origin.identity, origin, review };
}

async function readView(
  store: ProjectionSnapshotReader,
  generationId: string,
  perspective: ProjectionPerspective,
  plan: GenerationReadPlan,
): Promise<ScopedProjection> {
  const resolved = await resolveGenerationRead(store, generationId, perspective, plan);
  return readResolvedProjection(store, generationId, perspective, resolved);
}
