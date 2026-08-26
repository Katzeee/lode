import type { FactId } from "./types.js";

type HistoryOperation = "normal" | "undo" | "redo";

export type ReceiptLineage = Readonly<{
  channelId: string;
  operation: HistoryOperation;
  targetStepId: string | null;
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
