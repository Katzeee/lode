import {
  canonicalDigest,
  canonicalJson,
  type AuthorityReceipt,
  type ContributionFact,
  type FactSnapshot,
  type HistoryChannelId,
} from "../fact/index.js";
import type { ScopedProjectionGeneration } from "../reconcile/index.js";
import { planCompensation } from "./compensation.js";
import { rebuildHistoryState } from "./state.js";
import type { HistoryEvidence, HistoryPlan, HistoryQuery, HistorySelection } from "./types.js";

export function queryHistory(
  channelId: HistoryChannelId,
  receipts: readonly AuthorityReceipt[],
  snapshot: FactSnapshot,
  generation: ScopedProjectionGeneration,
): HistoryQuery {
  const state = rebuildHistoryState(receipts, channelId);
  return {
    channelId,
    undo: selectionFor(
      "undo",
      state.undoStack.at(-1) ?? null,
      state,
      receipts,
      snapshot,
      generation,
    ),
    redo: selectionFor(
      "redo",
      state.redoStack.at(-1) ?? null,
      state,
      receipts,
      snapshot,
      generation,
    ),
  };
}

export function historyTargetFactIds(
  channelId: HistoryChannelId,
  receipts: readonly AuthorityReceipt[],
): readonly string[] {
  const state = rebuildHistoryState(receipts, channelId);
  const targets = new Set(
    [state.undoStack.at(-1), state.redoStack.at(-1)].filter(
      (invocationId): invocationId is string => invocationId !== undefined,
    ),
  );
  return receipts.flatMap((receipt) => (targets.has(receipt.invocationId) ? receipt.factIds : []));
}

export function validateHistorySelection(
  selection: HistorySelection,
  actorId: string,
  receipts: readonly AuthorityReceipt[],
  snapshot: FactSnapshot,
  generation: ScopedProjectionGeneration,
): HistoryPlan {
  const current = queryHistory(selection.channelId, receipts, snapshot, generation)[
    selection.operation
  ];
  if (!current) {
    return { kind: "unavailable", reason: "History operation has no current target" };
  }
  if (
    current.targetInvocationId !== selection.targetInvocationId ||
    current.headInvocationId !== selection.headInvocationId ||
    current.headOrdinal !== selection.headOrdinal ||
    current.token !== selection.token ||
    canonicalJson(current.evidence) !== canonicalJson(selection.evidence)
  ) {
    return { kind: "stale", reason: "History channel head or compensation evidence changed" };
  }
  const targetFacts = contributionFactsForReceipt(
    receiptById(receipts, selection.targetInvocationId),
    snapshot,
  );
  const intent = targetFacts[0]?.body.intent;
  if (!intent) {
    return { kind: "unavailable", reason: "History target has no Contributions" };
  }
  const bodies = selection.evidence.compensations.map((mutation) => ({
    kind: "contribution" as const,
    actorId,
    intent,
    mutation,
  }));
  const [first, ...rest] = bodies;
  if (!first) {
    return { kind: "unavailable", reason: "History Step has no compensations" };
  }
  return {
    kind: "ready",
    targetInvocationId: selection.targetInvocationId,
    write: { kind: "transaction", bodies: [first, ...rest] },
  };
}

function selectionFor(
  operation: "undo" | "redo",
  targetInvocationId: string | null,
  state: ReturnType<typeof rebuildHistoryState>,
  receipts: readonly AuthorityReceipt[],
  snapshot: FactSnapshot,
  generation: ScopedProjectionGeneration,
): HistorySelection | null {
  if (!targetInvocationId) {
    return null;
  }
  const receipt = receiptById(receipts, targetInvocationId);
  const targetFacts = contributionFactsForReceipt(receipt, snapshot);
  const compensation = planCompensation(targetFacts, snapshot, generation);
  if (compensation.kind !== "ready") {
    return null;
  }
  const evidence: HistoryEvidence = {
    targetInvocationId,
    targetFactIds: targetFacts.map((fact) => fact.id),
    compensations: compensation.mutations,
  };
  return {
    token: canonicalDigest({
      channelId: state.channelId,
      operation,
      headInvocationId: state.headInvocationId,
      headOrdinal: state.headOrdinal,
      evidence,
    }),
    channelId: state.channelId,
    operation,
    targetInvocationId,
    headInvocationId: state.headInvocationId,
    headOrdinal: state.headOrdinal,
    frontier: generation.identity.frontier,
    evidence,
  } as HistorySelection;
}

function receiptById(
  receipts: readonly AuthorityReceipt[],
  invocationId: string,
): AuthorityReceipt | null {
  return receipts.find((receipt) => receipt.invocationId === invocationId) ?? null;
}

function contributionFactsForReceipt(
  receipt: AuthorityReceipt | null,
  snapshot: FactSnapshot,
): readonly ContributionFact[] {
  if (!receipt) {
    return [];
  }
  const ids = new Set(receipt.factIds);
  return snapshot.facts.filter(
    (fact): fact is ContributionFact => fact.body.kind === "contribution" && ids.has(fact.id),
  );
}
