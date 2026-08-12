export type HistoryOperation = "normal" | "undo" | "redo";

export type ReceiptLineage = Readonly<{
  channelId: string;
  ordinal: number;
  parentStepId: string | null;
  operation: HistoryOperation;
  targetStepId: string | null;
}>;

export type AuthorityReceipt = Readonly<{
  workspaceId: string;
  replicaId: string;
  invocationId: string;
  requestDigest: string;
  factIds: readonly string[];
  committedFrontier: Readonly<Record<string, number>>;
  lineage: ReceiptLineage | null;
}>;
