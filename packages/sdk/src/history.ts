import type {
  HistoryQueryResult as ProtocolHistoryQuery,
  HistorySelection as ProtocolHistorySelection,
} from "@lode/protocol/dto/history";
import type { ContributionMutation } from "./fact.js";
import type { ProtocolDto } from "./model.js";
import type { HistoryOperation } from "./protocol-enums/model.js";

type HistoryEvidence = Omit<ProtocolDto<NonNullable<ProtocolHistorySelection["evidence"]>>, "compensations"> &
  Readonly<{ compensations: readonly ContributionMutation[] }>;
export type HistorySelection = Omit<ProtocolDto<ProtocolHistorySelection>, "operation" | "evidence"> &
  Readonly<{ operation: Exclude<HistoryOperation, "normal">; evidence: HistoryEvidence }>;
export type HistoryQuery = Omit<ProtocolDto<ProtocolHistoryQuery>, "undo" | "redo"> &
  Readonly<{ undo: HistorySelection | null; redo: HistorySelection | null }>;
