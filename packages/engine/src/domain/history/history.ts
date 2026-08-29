import { canonicalDigest, type FactId, type FactSnapshot, type HistoryChannelId } from "../fact/index.js";
import type { InterpretedProjectionGeneration } from "../reconcile/index.js";
import { planInvocationCompensation } from "./compensation.js";
import { historySteps, rebuildHistoryState, type HistoryState } from "./state.js";
import type { HistoryPlan, HistoryQuery, HistorySelection } from "./types.js";

export function queryHistory(
  channelId: HistoryChannelId,
  snapshot: FactSnapshot,
  state: HistoryState = rebuildHistoryState(snapshot, channelId),
): HistoryQuery {
  return {
    channelId,
    undo: selectionFor("undo", state.undoStack.at(-1) ?? null, state),
    redo: selectionFor("redo", state.redoStack.at(-1) ?? null, state),
  };
}

export function validateHistorySelection(
  operation: "undo" | "redo",
  selection: HistorySelection,
  snapshot: FactSnapshot,
  generation: InterpretedProjectionGeneration,
): HistoryPlan {
  const state = rebuildHistoryState(snapshot, selection.channelId);
  const targetStepId = operation === "undo" ? (state.undoStack.at(-1) ?? null) : (state.redoStack.at(-1) ?? null);
  const current = selectionFor(operation, targetStepId, state);
  if (!current || !targetStepId) {
    return { kind: "unavailable", reason: "History operation has no current target" };
  }
  if (current.token !== selection.token) {
    return { kind: "stale", reason: "History channel head changed" };
  }
  const target = historySteps(snapshot, selection.channelId).find((step) => step.id === targetStepId);
  if (!target) {
    return { kind: "unavailable", reason: "History Step is not available" };
  }
  const currentCompensation = planInvocationCompensation(target.actionFacts, snapshot, generation);
  if (currentCompensation.kind !== "ready") {
    return currentCompensation;
  }
  return { kind: "ready", targetStepId, writes: currentCompensation.writes };
}

function selectionFor(
  operation: "undo" | "redo",
  targetStepId: FactId | null,
  state: HistoryState,
): HistorySelection | null {
  if (!targetStepId) {
    return null;
  }
  return {
    token: canonicalDigest({
      channelId: state.channelId,
      operation,
      headStepId: state.headStepId,
      targetStepId,
    }),
    channelId: state.channelId,
  };
}
