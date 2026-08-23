import type { EditIntent, FactId, AuthoredAction } from "./types.js";

type HistoryOperation = "normal" | "undo" | "redo";

export type ReceiptInverseBatch = Readonly<{
  intent: EditIntent;
  actions: readonly [AuthoredAction, ...AuthoredAction[]];
}>;

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
  factIds: readonly FactId[];
  committedFrontier: Readonly<Record<string, number>>;
  lineage: ReceiptLineage | null;
  inverse: readonly ReceiptInverseBatch[];
}>;
