import type { ReviewQueryRequest } from "@lode/sdk";
import type { ContributionFact, FactSnapshot } from "../../../domain/fact/index.js";
import { queryReview, type ReviewQuery } from "../../../domain/review/index.js";
import type { FactAuthority } from "../../authority/fact-authority.js";
import type { ProjectionSnapshotReader, ReviewReadModelReader } from "../../materialization/index.js";
import { readMutationGeneration } from "../generation-reading/index.js";

type ReviewFactReader = Pick<FactAuthority, "facts" | "relatedFacts">;
type ReviewProjectionReader = ProjectionSnapshotReader & ReviewReadModelReader;

export async function queryWorkspaceReview(
  workspaceId: string,
  query: ReviewQueryRequest,
  snapshot: FactSnapshot,
  facts: ReviewFactReader,
  projections: ReviewProjectionReader,
  generationId: string,
  reviewCapabilityKey?: string,
): Promise<ReviewQuery> {
  const after = query.after ?? null;
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
  const scopePage = await projections.reviewScopes(generationId, after, limit);
  const selectedIds = scopePage.scopes.flatMap((scope) => scope.contributionIds);
  const selectedFacts = facts
    .facts(selectedIds)
    .filter((fact): fact is ContributionFact => fact.body.kind === "contribution" && fact.body.intent === "proposal");
  const pending = new Map(selectedFacts.map((fact) => [fact.id, fact]));
  const supportBatch = await projections.reviewSupport(generationId, selectedIds);
  const supportByContribution = new Map(supportBatch.entries.map((entry) => [entry.identity, entry.supportIds]));
  const generation = await readMutationGeneration(
    projections,
    generationId,
    selectedFacts.map((fact) => fact.body.mutation),
  );
  const reviewFacts = facts.relatedFacts(selectedFacts.map((fact) => fact.id));
  return queryReview(
    workspaceId,
    { facts: reviewFacts, frontier: snapshot.frontier },
    generation,
    reviewCapabilityKey,
    {
      pending,
      context: { pending, supportByContribution },
      next: scopePage.next,
    },
  );
}
