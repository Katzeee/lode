import type { FactSnapshot } from "../../domain/fact/index.js";
import { rebuildGeneration, type ProjectionGeneration } from "../../domain/reconcile/index.js";
import { InMemoryDocumentStore } from "../../persistence/in-memory-document-store.js";
import { BoundedProjectionMaterializer } from "./bounded-materializer.js";
import { publicationStep } from "./generation-publication.js";
import type {
  ProjectionGenerationStore,
  ProposalWorkspaceOptions,
} from "./proposal-workspace-types.js";

export async function openWorkspaceGeneration(options: ProposalWorkspaceOptions): Promise<
  Readonly<{
    generations: ProjectionGenerationStore;
    generation: ProjectionGeneration;
    snapshot: FactSnapshot;
    authorityFault: string | null;
  }>
> {
  const admission = options.facts.admission();
  const snapshot = admission.snapshot;
  const checkpoint = await options.checkpoints?.load(
    options.workspaceId,
    snapshot,
    options.versions,
  );
  const generation =
    checkpoint?.kind === "valid"
      ? checkpoint.generation
      : rebuildGeneration(options.workspaceId, snapshot, options.versions).generation;
  const generations =
    options.generations ?? new BoundedProjectionMaterializer(new InMemoryDocumentStore());
  if (options.publisher) {
    await publicationStep(options.publisher.publish(generation), options.publicationTimeoutMs);
  }
  await publicationStep(generations.publish(generation), options.publicationTimeoutMs);
  return {
    generations,
    generation,
    snapshot,
    authorityFault:
      admission.kind === "fault" ? (admission.fault ?? "Authority admission fault") : null,
  };
}
