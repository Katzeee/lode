import type { HistoryQueryRequest } from "@lode/sdk";
import { frontierCovers, type AuthorityReceipt, type FactSnapshot } from "../../../domain/fact/index.js";
import { historyTargetFactIds, queryHistory, type HistoryQuery } from "../../../domain/history/index.js";
import type { FactAuthorityPort } from "../authority/authority-contract.js";
import type { ProjectionSnapshotReader } from "../projection/index.js";
import { readFactGeneration } from "../fact-generation-reader.js";

type HistoryFactReader = Pick<FactAuthorityPort, "receiptsForChannel" | "relatedFacts">;

export async function queryWorkspaceHistory(
  query: HistoryQueryRequest,
  snapshot: FactSnapshot,
  facts: HistoryFactReader,
  projections: ProjectionSnapshotReader,
  generationId: string,
): Promise<HistoryQuery> {
  const receipts = facts.receiptsForChannel(query.channelId);
  const factIds = historyTargetFactIds(query.channelId, receipts);
  const historyFacts = facts.relatedFacts(factIds);
  const scopedSnapshot = { facts: historyFacts, frontier: snapshot.frontier };
  const generation = await readFactGeneration(projections, generationId, scopedSnapshot);
  return queryHistory(query.channelId, receiptsCoveredBySnapshot(receipts, snapshot), scopedSnapshot, generation);
}

function receiptsCoveredBySnapshot(
  receipts: readonly AuthorityReceipt[],
  snapshot: FactSnapshot,
): readonly AuthorityReceipt[] {
  return receipts.filter((receipt) => frontierCovers(snapshot.frontier, receipt.committedFrontier));
}
