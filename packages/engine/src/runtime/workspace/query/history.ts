import type { HistoryQueryRequest } from "@lode/sdk";
import { frontierCovers, type AuthorityReceipt, type FactSnapshot } from "../../../domain/fact/index.js";
import { historyTargetFactIds, queryHistory, type HistoryQuery } from "../../../domain/history/index.js";
import type { FactAuthority } from "../../authority/fact-authority.js";
import type { ProjectionSnapshotReader } from "../../materialization/index.js";
import { readFactGeneration } from "../fact-generation-reader.js";

type HistoryFactReader = Pick<FactAuthority, "receiptsForChannel" | "relatedFacts">;

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
  const generation = await readFactGeneration(projections, generationId, scopedSnapshot, factIds);
  return queryHistory(query.channelId, receiptsCoveredBySnapshot(receipts, snapshot), scopedSnapshot, generation);
}

function receiptsCoveredBySnapshot(
  receipts: readonly AuthorityReceipt[],
  snapshot: FactSnapshot,
): readonly AuthorityReceipt[] {
  return receipts.filter((receipt) => frontierCovers(snapshot.frontier, receipt.committedFrontier));
}
