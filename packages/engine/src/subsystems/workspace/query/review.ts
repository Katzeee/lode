import type { ReviewQueryRequest } from "@lode/sdk";
import {
  factActionsFromFacts,
  stableStringCompare,
  type FactAction,
  type FactActionId,
  type FactSnapshot,
} from "../../../domain/fact/index.js";
import { queryReview, type ReviewQuery } from "../../../domain/review/index.js";
import type { FactAuthorityPort } from "../authority/authority-contract.js";
import type { WorkspaceProjectionState } from "../projection/index.js";

type ReviewFactReader = Pick<FactAuthorityPort, "factsOwningActions" | "relatedFactsOwningActions">;

export function queryWorkspaceReview(
  query: ReviewQueryRequest,
  snapshot: FactSnapshot,
  facts: ReviewFactReader,
  state: WorkspaceProjectionState,
): ReviewQuery {
  const after = query.after ?? null;
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
  const scopePage = reviewScopePage(state, after, limit);
  const selectedIds = scopePage.scopes.flatMap((scope) => scope.factActionIds);
  const { pending, supportByAction } = loadReviewContext(selectedIds, facts, state);
  const reviewFacts = facts.relatedFactsOwningActions([...pending.keys()]);
  return queryReview({ facts: reviewFacts, frontier: snapshot.frontier }, state.generation, {
    pending,
    context: { pending, supportByAction },
    next: scopePage.next,
  });
}

function reviewScopePage(state: WorkspaceProjectionState, after: string | null, limit: number) {
  const identities = Object.keys(state.review.scopes).sort(stableStringCompare);
  const start = after === null ? 0 : identities.findIndex((identity) => stableStringCompare(identity, after) > 0);
  const normalizedStart = start < 0 ? identities.length : start;
  const selected = identities.slice(normalizedStart, normalizedStart + limit);
  return {
    scopes: selected.map((identity) => ({ identity, factActionIds: state.review.scopes[identity] ?? [] })),
    next: normalizedStart + selected.length < identities.length ? (selected.at(-1) ?? null) : null,
  };
}

function loadReviewContext(
  selectedIds: readonly FactActionId[],
  facts: ReviewFactReader,
  state: WorkspaceProjectionState,
) {
  const pending = new Map<FactActionId, FactAction>();
  const supportByAction = new Map<FactActionId, readonly FactActionId[]>();
  const queued = new Set(selectedIds);
  const loaded = new Set<FactActionId>();

  while (queued.size > 0) {
    const batch = [...queued];
    queued.clear();
    batch.forEach((id) => loaded.add(id));
    const pendingIds = new Set(batch.filter((id) => state.review.supportByAction[id] !== undefined));
    for (const id of pendingIds) {
      supportByAction.set(id, state.review.supportByAction[id] ?? []);
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
