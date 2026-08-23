import type { ReviewQueryRequest } from "@lode/sdk";
import {
  factActionsFromFacts,
  type FactAction,
  type FactActionId,
  type FactSnapshot,
} from "../../../domain/fact/index.js";
import { queryReview, type ReviewQuery } from "../../../domain/review/index.js";
import type { FactAuthorityPort } from "../authority/authority-contract.js";
import type { ProjectionSnapshotReader, ReviewReadModelReader } from "../projection/index.js";
import { readFactActionGeneration } from "../generation-reading/index.js";

type ReviewFactReader = Pick<FactAuthorityPort, "factsOwningActions" | "relatedFactsOwningActions">;
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
  const selectedIds = scopePage.scopes.flatMap((scope) => scope.factActionIds);
  const { pending, supportByAction } = await loadReviewContext(generationId, selectedIds, facts, projections);
  const selectedActions = selectedIds
    .map((id) => pending.get(id))
    .filter((action): action is FactAction => action !== undefined);
  const generation = await readFactActionGeneration(projections, generationId, selectedActions);
  const reviewFacts = facts.relatedFactsOwningActions([...pending.keys()]);
  return queryReview(
    workspaceId,
    { facts: reviewFacts, frontier: snapshot.frontier },
    generation,
    reviewCapabilityKey,
    {
      pending,
      context: { pending, supportByAction },
      next: scopePage.next,
    },
  );
}

async function loadReviewContext(
  generationId: string,
  selectedIds: readonly FactActionId[],
  facts: ReviewFactReader,
  projections: ReviewProjectionReader,
) {
  const pending = new Map<FactActionId, FactAction>();
  const supportByAction = new Map<FactActionId, readonly FactActionId[]>();
  const queued = new Set(selectedIds);
  const loaded = new Set<FactActionId>();

  while (queued.size > 0) {
    const batch = [...queued];
    queued.clear();
    batch.forEach((id) => loaded.add(id));
    const support = await projections.reviewSupport(generationId, batch);
    const pendingIds = new Set(support.entries.map((entry) => entry.identity));
    for (const entry of support.entries) {
      supportByAction.set(entry.identity, entry.supportIds);
    }
    const actions = factActionsFromFacts(facts.factsOwningActions(batch));
    for (const action of actions) {
      if (action.intent !== "proposal" || !pendingIds.has(action.id)) {
        continue;
      }
      pending.set(action.id, action);
      if (!loaded.has(action.id)) {
        queued.add(action.id);
      }
      for (const supportId of supportByAction.get(action.id) ?? []) {
        if (!loaded.has(supportId)) {
          queued.add(supportId);
        }
      }
    }
  }
  return { pending, supportByAction };
}
