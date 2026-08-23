import {
  canonicalDigest,
  canonicalJson,
  factActionsFromFacts,
  type AuthorityReceipt,
  type FactSnapshot,
  type HistoryChannelId,
  type AuthoredAction,
} from "../fact/index.js";
import type { ScopedProjectionGeneration } from "../reconcile/index.js";
import { planCompensation } from "./compensation.js";
import { rebuildHistoryState, type HistoryState } from "./state.js";
import type { HistoryPlan, HistoryQuery, HistorySelection } from "./types.js";

export function queryHistory(
  channelId: HistoryChannelId,
  receipts: readonly AuthorityReceipt[],
  state: HistoryState = rebuildHistoryState(receipts, channelId),
): HistoryQuery {
  return {
    channelId,
    undo: selectionFor("undo", state.undoStack.at(-1) ?? null, state, receipts),
    redo: selectionFor("redo", state.redoStack.at(-1) ?? null, state, receipts),
  };
}

export function validateHistorySelection(
  selection: HistorySelection,
  receipts: readonly AuthorityReceipt[],
  snapshot: FactSnapshot,
  generation: ScopedProjectionGeneration,
): HistoryPlan {
  const state = rebuildHistoryState(receipts, selection.channelId);
  const targetInvocationId =
    selection.operation === "undo" ? (state.undoStack.at(-1) ?? null) : (state.redoStack.at(-1) ?? null);
  const current = selectionFor(selection.operation, targetInvocationId, state, receipts);
  if (!current) {
    return { kind: "unavailable", reason: "History operation has no current target" };
  }
  if (
    current.targetInvocationId !== selection.targetInvocationId ||
    current.headInvocationId !== selection.headInvocationId ||
    current.headOrdinal !== selection.headOrdinal ||
    current.token !== selection.token ||
    canonicalJson(current.targetFactIds) !== canonicalJson(selection.targetFactIds)
  ) {
    return { kind: "stale", reason: "History channel head or compensation evidence changed" };
  }
  const targetReceipt = receiptById(receipts, selection.targetInvocationId);
  if (!targetReceipt || targetReceipt.inverse.length === 0) {
    return { kind: "unavailable", reason: "History Step has no compensations" };
  }
  const targetIds = new Set(targetReceipt.factIds);
  const targetActions = factActionsFromFacts(snapshot.facts.filter((fact) => targetIds.has(fact.id)));
  const storedActions = targetReceipt.inverse.flatMap((batch) => batch.actions);
  const currentCompensation = planCompensation(targetActions, snapshot, generation, storedActions);
  if (currentCompensation.kind !== "ready" || !compensationEffectsEqual(currentCompensation.actions, storedActions)) {
    return { kind: "stale", reason: "History counteractions are no longer safe at the current projection" };
  }
  return {
    kind: "ready",
    targetInvocationId: selection.targetInvocationId,
    writes: targetReceipt.inverse,
  };
}

function compensationEffectsEqual(left: readonly AuthoredAction[], right: readonly AuthoredAction[]): boolean {
  return canonicalJson(compensationFootprint(left)) === canonicalJson(compensationFootprint(right));
}

function compensationFootprint(actions: readonly AuthoredAction[]): readonly unknown[] {
  return actions.map(compensationActionFootprint);
}

function compensationActionFootprint(authoredAction: AuthoredAction): unknown {
  const ignored = new Set<string>();
  if (authoredAction.kind === "rich-text-splice" && authoredAction.insert === "") {
    ignored.add("anchor");
  }
  return Object.fromEntries(Object.entries(authoredAction).filter(([key]) => !ignored.has(key)));
}

function selectionFor(
  operation: "undo" | "redo",
  targetInvocationId: string | null,
  state: ReturnType<typeof rebuildHistoryState>,
  receipts: readonly AuthorityReceipt[],
): HistorySelection | null {
  if (!targetInvocationId) {
    return null;
  }
  const receipt = receiptById(receipts, targetInvocationId);
  if (!receipt || receipt.inverse.length === 0) {
    return null;
  }
  const targetFactIds = receipt.factIds;
  return {
    token: canonicalDigest({
      channelId: state.channelId,
      operation,
      headInvocationId: state.headInvocationId,
      headOrdinal: state.headOrdinal,
      targetFactIds,
      inverse: receipt.inverse,
    }),
    channelId: state.channelId,
    operation,
    targetInvocationId,
    headInvocationId: state.headInvocationId,
    headOrdinal: state.headOrdinal,
    targetFactIds,
  };
}

function receiptById(receipts: readonly AuthorityReceipt[], invocationId: string): AuthorityReceipt | null {
  return receipts.find((receipt) => receipt.invocationId === invocationId) ?? null;
}
