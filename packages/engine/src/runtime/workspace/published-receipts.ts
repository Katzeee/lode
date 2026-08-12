import {
  frontierCovers,
  type AuthorityReceipt,
  type FactSnapshot,
} from "../../domain/fact/index.js";

export function receiptsCoveredBySnapshot(
  receipts: readonly AuthorityReceipt[],
  snapshot: FactSnapshot,
): readonly AuthorityReceipt[] {
  return receipts.filter((receipt) => frontierCovers(snapshot.frontier, receipt.committedFrontier));
}
