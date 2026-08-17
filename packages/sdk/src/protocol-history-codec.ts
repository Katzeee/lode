import type { HistoryQuery, HistorySelection } from "./history.js";
import { fromContributionMutation, toContributionMutation } from "./protocol-fact-codec.js";
import { fromProtocolValue, required, toProtocolValue } from "./protocol-shape-codec.js";

export function toHistorySelection(selection: HistorySelection): Record<string, unknown> {
  const value = toProtocolValue(selection) as Record<string, unknown>;
  value.evidence = {
    ...(toProtocolValue(selection.evidence) as Record<string, unknown>),
    compensations: selection.evidence.compensations.map(toContributionMutation),
  };
  return value;
}

export function fromHistorySelection(value: unknown): HistorySelection {
  const rawSelection = value as Record<string, unknown>;
  const rawEvidence = required(rawSelection.evidence as Record<string, unknown> | null, "History evidence");
  const selection = fromProtocolValue(value) as Record<string, unknown>;
  const evidence = required(selection.evidence as Record<string, unknown> | null, "History evidence");
  selection.evidence = {
    ...evidence,
    compensations: (rawEvidence.compensations as readonly unknown[]).map(fromContributionMutation),
  };
  return selection as HistorySelection;
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
