import type {
  HistoryQueryResult as ProtocolHistoryQuery,
  HistorySelection as ProtocolHistorySelection,
} from "@lode/protocol/dto/history";
import type { ProtocolDto } from "./model.js";

export type HistorySelection = ProtocolDto<ProtocolHistorySelection>;
export type HistoryQuery = Omit<ProtocolDto<ProtocolHistoryQuery>, "undo" | "redo"> &
  Readonly<{ undo: HistorySelection | null; redo: HistorySelection | null }>;
