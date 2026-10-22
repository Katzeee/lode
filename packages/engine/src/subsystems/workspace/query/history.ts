import type { HistoryQueryRequest } from "@lode/sdk";
import type { FactSnapshot } from "../../../domain/fact/index.js";
import { queryHistory, type HistoryQuery } from "../../../domain/history/index.js";

export function queryWorkspaceHistory(query: HistoryQueryRequest, snapshot: FactSnapshot): Promise<HistoryQuery> {
  return Promise.resolve(queryHistory(query.channelId, snapshot));
}
