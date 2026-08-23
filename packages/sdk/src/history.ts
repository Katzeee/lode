import type {
  HistoryQueryResult as ProtocolHistoryQuery,
  HistorySelection as ProtocolHistorySelection,
} from "@lode/protocol/dto/history";
import type { FactId } from "./fact-identities.js";
import type { ProtocolDto } from "./model.js";
import type { HistoryOperation } from "./protocol-enums/model.js";

export type HistorySelection = Omit<ProtocolDto<ProtocolHistorySelection>, "operation" | "targetFactIds"> &
  Readonly<{ operation: Exclude<HistoryOperation, "normal">; targetFactIds: readonly FactId[] }>;
export type HistoryQuery = Omit<ProtocolDto<ProtocolHistoryQuery>, "undo" | "redo"> &
  Readonly<{ undo: HistorySelection | null; redo: HistorySelection | null }>;
