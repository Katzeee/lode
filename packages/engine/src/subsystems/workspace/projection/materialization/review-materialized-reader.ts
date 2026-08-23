import type { FactActionId, ProjectionIdentity } from "../../../../domain/fact/index.js";
import type { MaterializedGenerationRead } from "./store/bounded-materialized-store.js";
import { reviewMaterializedDataset } from "./materialized-review-read-model.js";

export async function readReviewScopes(
  generation: MaterializedGenerationRead<ProjectionIdentity>,
  after: string | null,
  limit: number,
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Review page limit must be between 1 and 100");
  }
  const page = await generation.page(reviewMaterializedDataset("scopes"), after, limit);
  const scopes = page.entries.map((entry) => ({
    identity: entry.descriptor.identity,
    factActionIds: entry.value,
  }));
  return {
    identity: generation.identity,
    scopes,
    next: page.hasMore ? (scopes.at(-1)?.identity ?? null) : null,
  };
}

export async function readReviewSupport(
  generation: MaterializedGenerationRead<ProjectionIdentity>,
  factActionIds: readonly FactActionId[],
) {
  const selected = await generation.exact(reviewMaterializedDataset("support"), factActionIds);
  return {
    identity: generation.identity,
    entries: selected.map((entry) => ({
      identity: entry.descriptor.identity as FactActionId,
      supportIds: entry.value,
    })),
  };
}
