import { canonicalDigest, type AuthorityReceipt, type FactSnapshot, type HistoryChannelId } from "../fact/index.js";
import type { ScopedProjectionGeneration } from "../reconcile/index.js";
import { planInvocationCompensation } from "./compensation.js";
import { rebuildHistoryState, type HistoryState } from "./state.js";
import type { HistoryPlan, HistoryQuery, HistorySelection } from "./types.js";

export function queryHistory(
  channelId: HistoryChannelId,
  receipts: readonly AuthorityReceipt[],
  state: HistoryState = rebuildHistoryState(receipts, channelId),
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
  receipts: readonly AuthorityReceipt[],
  snapshot: FactSnapshot,
  generation: ScopedProjectionGeneration,
): HistoryPlan {
  const state = rebuildHistoryState(receipts, selection.channelId);
  const targetInvocationId = operation === "undo" ? (state.undoStack.at(-1) ?? null) : (state.redoStack.at(-1) ?? null);
  const current = selectionFor(operation, targetInvocationId, state);
  if (!current) {
    return { kind: "unavailable", reason: "History operation has no current target" };
  }
  if (targetInvocationId === null) {
    return { kind: "unavailable", reason: "History operation has no current target" };
  }
  if (current.token !== selection.token) {
    return { kind: "stale", reason: "History channel head changed" };
  }
  const targetReceipt = receiptById(receipts, targetInvocationId);
  if (!targetReceipt) {
    return { kind: "unavailable", reason: "History Step is not available" };
  }
  const factsById = new Map(snapshot.facts.map((fact) => [fact.id, fact]));
  const targetFacts = targetReceipt.factIds.flatMap((factId) => {
    const fact = factsById.get(factId);
    return fact ? [fact] : [];
  });
  if (targetFacts.length !== targetReceipt.factIds.length) {
    return { kind: "unavailable", reason: "History Step Facts are not available" };
  }
  const currentCompensation = planInvocationCompensation(targetFacts, snapshot, generation);
  if (currentCompensation.kind !== "ready") {
    return currentCompensation;
  }
  return {
    kind: "ready",
    targetInvocationId,
    writes: currentCompensation.writes,
  };
}

function selectionFor(
  operation: "undo" | "redo",
  targetInvocationId: string | null,
  state: ReturnType<typeof rebuildHistoryState>,
): HistorySelection | null {
  if (!targetInvocationId) {
    return null;
  }
  return {
    token: canonicalDigest({
      channelId: state.channelId,
      operation,
      headInvocationId: state.headInvocationId,
      targetInvocationId,
    }),
    channelId: state.channelId,
  };
}

function receiptById(receipts: readonly AuthorityReceipt[], invocationId: string): AuthorityReceipt | null {
  return receipts.find((receipt) => receipt.invocationId === invocationId) ?? null;
}
