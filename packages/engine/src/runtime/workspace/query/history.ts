import type { HistoryQueryRequest } from "../../../application/contract.js";
import type { FactSnapshot } from "../../../domain/fact/index.js";
import {
  historyTargetFactIds,
  queryHistory,
  type HistoryQuery,
} from "../../../domain/history/index.js";
import type { FactAuthority } from "../../authority/fact-authority.js";
import type { ProjectionSnapshotReader } from "../../materialization/index.js";
import { readFactGeneration } from "../fact-generation-reader.js";
import { receiptsCoveredBySnapshot } from "../published-receipts.js";

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
  return queryHistory(
    query.channelId,
    receiptsCoveredBySnapshot(receipts, snapshot),
    scopedSnapshot,
    generation,
  );
}
