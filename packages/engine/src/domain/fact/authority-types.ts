import type { FactId, HistoryChannelId, HistoryOperation } from "./fact-value-types.js";

export type ReceiptLineage = Readonly<{
  channelId: HistoryChannelId;
  operation: HistoryOperation;
  targetStepId: FactId | null;
}>;

export type AuthorityReceipt = Readonly<{
  workspaceId: string;
  replicaId: string;
  invocationId: string;
  requestDigest: string;
  factIds: readonly FactId[];
  committedFrontier: Readonly<Record<string, number>>;
  lineage: ReceiptLineage | null;
}>;
