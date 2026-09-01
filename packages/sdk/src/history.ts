import type {
  HistoryQueryResult as ProtocolHistoryQuery,
  HistorySelection as ProtocolHistorySelection,
} from "@lode/protocol/proto";
import type { ProtocolDto } from "./protocol-dto.js";

export type HistorySelection = ProtocolDto<ProtocolHistorySelection>;
export type HistoryQuery = Omit<ProtocolDto<ProtocolHistoryQuery>, "undo" | "redo"> &
  Readonly<{ undo: HistorySelection | null; redo: HistorySelection | null }>;
