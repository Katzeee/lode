import type {
  ContributionBody,
  FactTransactionPlan,
  FactFrontier,
  HistoryChannelId,
  InvocationId,
  Mutation,
} from "../fact/index.js";

export type HistoryEvidence = Readonly<{
  targetInvocationId: InvocationId;
  targetFactIds: readonly string[];
  compensations: readonly Mutation[];
}>;

export type HistorySelection = Readonly<{
  token: string;
  channelId: HistoryChannelId;
  operation: "undo" | "redo";
  targetInvocationId: InvocationId;
  headInvocationId: InvocationId | null;
  headOrdinal: number;
  frontier: FactFrontier;
  evidence: HistoryEvidence;
}>;

export type HistoryQuery = Readonly<{
  channelId: HistoryChannelId;
  undo: HistorySelection | null;
  redo: HistorySelection | null;
}>;

export type HistoryPlan =
  | Readonly<{
      kind: "ready";
      write: FactTransactionPlan<ContributionBody>;
      targetInvocationId: InvocationId;
    }>
  | Readonly<{ kind: "unavailable"; reason: string }>
  | Readonly<{ kind: "stale"; reason: string }>;
