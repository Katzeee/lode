import type {
  EngineQuery,
  EngineQueryValue,
  InvocationOutcome,
} from "../../application/contract.js";
import type { FactSnapshot } from "../../domain/fact/index.js";
import { frontierCovers } from "../../domain/fact/index.js";
import { queryHistory } from "../../domain/history/index.js";
import type { HistoryPlanningObserver } from "../../domain/history/index.js";
import type { ProjectionGeneration } from "../../domain/reconcile/index.js";
import type { ConflictIssue } from "../../domain/conflict/index.js";
import { queryReview } from "../../domain/review/index.js";
import type { ReviewGenerationPage } from "./mutation-generation-reader.js";
import { readFactGeneration, readReviewGeneration } from "./mutation-generation-reader.js";
import { historyTargetFactIds } from "../../domain/history/index.js";
import type { ProjectionGenerationStore } from "./proposal-workspace-types.js";
import type { FactStore } from "../authority/fact-store.js";
import { receiptsCoveredBySnapshot } from "./published-receipts.js";
import { pendingResult, publishedResult } from "./workspace-results.js";

export async function queryWorkspace(
  workspaceId: string,
  query: EngineQuery,
  facts: FactStore,
  snapshot: FactSnapshot,
  generations: ProjectionGenerationStore,
  generationId: string,
  projectionFailure: string | null,
  reviewCapabilityKey?: string,
  historyPlanningObserver?: HistoryPlanningObserver,
): Promise<EngineQueryValue> {
  if (query.workspaceId !== workspaceId) {
    throw new Error("Query belongs to another Workspace");
  }
  if (query.kind === "projection") {
    return generations.page(generationId, query);
  }
  if (query.kind === "conflicts") {
    const page = await generations.page(generationId, {
      kind: "projection",
      workspaceId,
      view: "review",
      section: "conflictIssues",
      after: query.after,
      limit: query.limit,
    });
    return {
      generationId: page.identity.generationId,
      frontier: page.identity.frontier,
      issues: page.entries.map((entry) => entry.value as ConflictIssue),
      next: page.next,
    };
  }
  const receipts = facts.receipts();
  const reviewPage =
    query.kind === "review"
      ? await readReviewGeneration(generations, generationId, snapshot, query)
      : undefined;
  const factIds = query.kind === "history" ? historyTargetFactIds(query.channelId, receipts) : [];
  const generation =
    reviewPage?.generation ??
    (await readFactGeneration(generations, generationId, snapshot, factIds));
  return queryPublishedWorkspace(
    workspaceId,
    query,
    facts,
    snapshot,
    generation,
    projectionFailure,
    reviewCapabilityKey,
    reviewPage,
    historyPlanningObserver,
  );
}

function queryPublishedWorkspace(
  workspaceId: string,
  query: EngineQuery,
  facts: FactStore,
  snapshot: FactSnapshot,
  generation: ProjectionGeneration,
  projectionFailure: string | null,
  reviewCapabilityKey?: string,
  reviewPage?: ReviewGenerationPage,
  historyPlanningObserver?: HistoryPlanningObserver,
): EngineQueryValue {
  if (query.workspaceId !== workspaceId) {
    throw new Error("Query belongs to another Workspace");
  }
  switch (query.kind) {
    case "projection":
      throw new Error("Projection pages are read from the bounded generation store");
    case "review":
      return queryReview(
        workspaceId,
        snapshot,
        generation,
        reviewCapabilityKey,
        reviewPage ? { pending: reviewPage.pending, next: reviewPage.next } : undefined,
      );
    case "history":
      return queryHistory(
        query.channelId,
        receiptsCoveredBySnapshot(facts.receipts(), snapshot),
        snapshot,
        generation,
        historyPlanningObserver,
      );
    case "invocation":
      return invocationOutcome(query.invocationId, facts, generation, projectionFailure);
    case "conflicts":
      throw new Error("Conflict pages are read before scoped generation loading");
  }
}

function invocationOutcome(
  invocationId: string,
  facts: FactStore,
  generation: ProjectionGeneration,
  projectionFailure: string | null,
): InvocationOutcome {
  const receipt = facts.receipt(invocationId);
  if (!receipt) {
    return { status: "absent" };
  }
  if (frontierCovers(generation.identity.frontier, receipt.committedFrontier)) {
    return publishedResult(receipt, generation.identity.generationId);
  }
  return pendingResult(
    receipt,
    generation.identity.generationId,
    projectionFailure ?? "projection has not reached the committed frontier",
  );
}
