import type { HistoryQueryRequest } from "@lode/sdk";
import { frontierCovers, type AuthorityReceipt, type FactSnapshot } from "../../../domain/fact/index.js";
import { queryHistory, type HistoryQuery } from "../../../domain/history/index.js";
import type { FactAuthorityPort } from "../authority/authority-contract.js";

type HistoryFactReader = Pick<FactAuthorityPort, "receiptsForChannel">;

export function queryWorkspaceHistory(
  query: HistoryQueryRequest,
  snapshot: FactSnapshot,
  facts: HistoryFactReader,
): Promise<HistoryQuery> {
  const receipts = facts.receiptsForChannel(query.channelId);
  return Promise.resolve(queryHistory(query.channelId, receiptsCoveredBySnapshot(receipts, snapshot)));
}

function receiptsCoveredBySnapshot(
  receipts: readonly AuthorityReceipt[],
  snapshot: FactSnapshot,
): readonly AuthorityReceipt[] {
  return receipts.filter((receipt) => frontierCovers(snapshot.frontier, receipt.committedFrontier));
}
