import type { HistoryChannelId, GraphAction, EditIntent } from "../fact/index.js";

export type CompensationBatch = Readonly<{
  intent: EditIntent;
  actions: readonly [GraphAction, ...GraphAction[]];
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
      targetInvocationId: string;
    }>
  | Readonly<{ kind: "unavailable"; reason: string }>
  | Readonly<{ kind: "stale"; reason: string }>;
