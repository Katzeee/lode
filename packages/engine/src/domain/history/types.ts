import type { FactId, HistoryChannelId, GraphAction, EditIntent, HistoryRestoration } from "../fact/index.js";

export type CompensationBatch = Readonly<{
  intent: EditIntent;
  actions: readonly [GraphAction, ...GraphAction[]];
  restorations?: readonly Omit<HistoryRestoration, "factIndex">[];
}>;

export type HistorySelection = Readonly<{
  token: string;
  channelId: HistoryChannelId;
}>;

export type HistoryQuery = Readonly<{
  channelId: HistoryChannelId;
  undo: HistorySelection | null;
  redo: HistorySelection | null;
}>;

export type HistoryPlan =
  | Readonly<{
      kind: "ready";
      writes: readonly CompensationBatch[];
      targetStepId: FactId;
    }>
  | Readonly<{ kind: "unavailable"; reason: string }>
  | Readonly<{ kind: "stale"; reason: string }>;
