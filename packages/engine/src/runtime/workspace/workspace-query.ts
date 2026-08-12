import type {
  EngineQuery,
  EngineQueryValue,
  InvocationOutcome,
} from "../../application/contract.js";
import type { AuthorityReceipt, Fact, FactSnapshot } from "../../domain/fact/index.js";
import { frontierCovers } from "../../domain/fact/index.js";
import { queryHistory } from "../../domain/history/index.js";
import type { HistoryPlanningObserver } from "../../domain/history/index.js";
import type { ProjectionGeneration } from "../../domain/reconcile/index.js";
import type { ConflictIssue } from "../../domain/conflict/index.js";
import { queryReview } from "../../domain/review/index.js";
import type { ReviewGenerationPage } from "./proposal-workspace-types.js";
import { readFactGeneration, readReviewGeneration } from "./mutation-generation-reader.js";
import { historyTargetFactIds } from "../../domain/history/index.js";
import type { ProjectionGenerationStore } from "./proposal-workspace-types.js";
import type { FactStore } from "../authority/fact-store.js";
import { receiptsCoveredBySnapshot } from "./published-receipts.js";
import { pendingResult, publishedResult } from "./workspace-results.js";
import { hardDeletePreview } from "./hard-delete.js";
import { readView } from "./view-reader.js";

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
  if (query.kind === "schema-search") {
    const page = await generations.schemaSearch(
      generationId,
      query.view,
      query.schemaId,
      query.after ?? null,
      query.limit ?? 50,
    );
    return {
      generationId: page.identity.generationId,
      frontier: page.identity.frontier,
      view: query.view,
      schemaId: query.schemaId,
      nodeIds: page.nodeIds,
      next: page.next,
    };
  }
  if (query.kind === "view") {
    return readView(
      generations,
      generationId,
      query.view,
      query.viewNodeId,
      query.after ?? null,
      query.limit ?? 50,
    );
  }
  if (query.kind === "hard-delete-preview") {
    return hardDeletePreview(workspaceId, query.nodeId, snapshot, facts, generationId);
  }
  const reviewPage =
    query.kind === "review"
      ? await readReviewGeneration(generations, generationId, query, facts)
      : undefined;
  const historyReceipts =
    query.kind === "history" ? facts.receiptsForChannel(query.channelId) : undefined;
  const factIds =
    query.kind === "history" ? historyTargetFactIds(query.channelId, historyReceipts ?? []) : [];
  const historyFacts = query.kind === "history" ? facts.relatedFacts(factIds) : undefined;
  const generation =
    reviewPage?.generation ??
    (await readFactGeneration(
      generations,
      generationId,
      historyFacts ? { facts: historyFacts, frontier: snapshot.frontier } : snapshot,
      factIds,
    ));
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
    historyReceipts,
    historyFacts,
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
  historyReceipts?: readonly AuthorityReceipt[],
  historyFacts?: readonly Fact[],
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
        reviewPage ? { facts: reviewPage.facts, frontier: snapshot.frontier } : snapshot,
        generation,
        reviewCapabilityKey,
        reviewPage
          ? { pending: reviewPage.pending, context: reviewPage.context, next: reviewPage.next }
          : undefined,
      );
    case "history":
      return queryHistory(
        query.channelId,
        receiptsCoveredBySnapshot(historyReceipts ?? facts.receipts(), snapshot),
        historyFacts ? { facts: historyFacts, frontier: snapshot.frontier } : snapshot,
        generation,
        historyPlanningObserver,
      );
    case "invocation": {
      const outcome = invocationOutcome(query.invocationId, facts, generation, projectionFailure);
      facts.settleInvocation(query.invocationId);
      return outcome;
    }
    case "conflicts":
      throw new Error("Conflict pages are read before scoped generation loading");
    case "schema-search":
      throw new Error("Schema Search pages are read before scoped generation loading");
    case "view":
      throw new Error("Views are read before scoped generation loading");
    case "hard-delete-preview":
      throw new Error("Hard Delete previews are read before scoped generation loading");
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
