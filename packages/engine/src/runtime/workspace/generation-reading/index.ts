import type { EditMutation } from "../../../domain/edit/index.js";
import type { Mutation, ViewMode } from "../../../domain/fact/index.js";
import type { ScopedProjection, ScopedProjectionGeneration } from "../../../domain/reconcile/index.js";
import type { ProjectionSnapshotReader } from "../../materialization/index.js";
import { planEditGenerationRead, planMutationGenerationRead, type GenerationReadPlan } from "./read-plan.js";
import { readResolvedProjection } from "./projection-reader.js";
import { resolveGenerationRead } from "./scope-resolver.js";

export function readMutationGeneration(
  store: ProjectionSnapshotReader,
  generationId: string,
  mutations: readonly Mutation[],
): Promise<ScopedProjectionGeneration> {
  return readScopedGeneration(store, generationId, planMutationGenerationRead(mutations));
}

export function readEditGeneration(
  store: ProjectionSnapshotReader,
  generationId: string,
  edits: readonly EditMutation[],
): Promise<ScopedProjectionGeneration> {
  return readScopedGeneration(store, generationId, planEditGenerationRead(edits));
}

async function readScopedGeneration(
  store: ProjectionSnapshotReader,
  generationId: string,
  plan: GenerationReadPlan,
): Promise<ScopedProjectionGeneration> {
  return store.withReadLease(generationId, async () => {
    const origin = await readView(store, generationId, "origin", plan);
    const review = await readView(store, generationId, "review", plan);
    return { identity: origin.identity, origin, review };
  });
}

async function readView(
  store: ProjectionSnapshotReader,
  generationId: string,
  view: ViewMode,
  plan: GenerationReadPlan,
): Promise<ScopedProjection> {
  const resolved = await resolveGenerationRead(store, generationId, view, plan);
  return readResolvedProjection(store, generationId, view, resolved);
}
