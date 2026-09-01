import type { HistoryQuery, HistorySelection } from "./history.js";
import { fromProtocolValue, toProtocolValue } from "./protocol-value-codec.js";

export function toHistorySelection(selection: HistorySelection): Record<string, unknown> {
  return toProtocolValue(selection) as Record<string, unknown>;
}

export function fromHistorySelection(value: unknown): HistorySelection {
  return fromProtocolValue(value) as HistorySelection;
}

export function toHistoryQuery(value: HistoryQuery): Record<string, unknown> {
  return {
    ...(toProtocolValue(value) as Record<string, unknown>),
    undo: value.undo === null ? null : toHistorySelection(value.undo),
    redo: value.redo === null ? null : toHistorySelection(value.redo),
  };
}

export function fromHistoryQuery(value: unknown): HistoryQuery {
  const raw = value as Record<string, unknown>;
  const result = fromProtocolValue(value) as Record<string, unknown>;
  result.undo = raw.undo === null ? null : fromHistorySelection(raw.undo);
  result.redo = raw.redo === null ? null : fromHistorySelection(raw.redo);
  return result as HistoryQuery;
}
