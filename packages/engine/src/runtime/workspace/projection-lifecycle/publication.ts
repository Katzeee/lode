import type { FactSnapshot } from "../../../domain/fact/index.js";
import type { ProjectionGeneration } from "../../../domain/reconcile/index.js";
import { createReviewReadModel } from "../../../domain/review/index.js";
import type { ProjectionCheckpointStore, ProjectionPublisher } from "../../materialization/index.js";

export type ProjectionPublication = Readonly<{
  projections: ProjectionPublisher;
  checkpoints?: ProjectionCheckpointStore;
}>;

export async function publishProjectionGeneration(
  generation: ProjectionGeneration,
  snapshot: FactSnapshot,
  publication: ProjectionPublication,
): Promise<void> {
  await publicationStep(
    publication.projections.publish(generation, createReviewReadModel(snapshot, generation.review)),
  );
  try {
    await publication.checkpoints?.save(snapshot, generation);
  } catch {
    /* Checkpoints accelerate restart and never participate in publication. */
  }
}

async function publicationStep<T>(task: Promise<T>): Promise<T> {
  const timeoutMs = 5_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Projection publication timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
