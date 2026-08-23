import type { FactId, HistoryChannelId, InvocationId, ReceiptInverseBatch } from "../fact/index.js";

export type HistorySelection = Readonly<{
  token: string;
  channelId: HistoryChannelId;
  operation: "undo" | "redo";
  targetInvocationId: InvocationId;
  headInvocationId: InvocationId | null;
  headOrdinal: number;
  targetFactIds: readonly FactId[];
}>;

export type HistoryQuery = Readonly<{
  channelId: HistoryChannelId;
  undo: HistorySelection | null;
  redo: HistorySelection | null;
}>;

export type HistoryPlan =
  | Readonly<{
      kind: "ready";
      writes: readonly ReceiptInverseBatch[];
      targetInvocationId: InvocationId;
    }>
  | Readonly<{ kind: "unavailable"; reason: string }>
  | Readonly<{ kind: "stale"; reason: string }>;
