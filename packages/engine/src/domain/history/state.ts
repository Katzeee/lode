import type {
  ActionFact,
  FactId,
  FactSnapshot,
  HistoryBody,
  HistoryChannelId,
  HistoryOperation,
  ReceiptLineage,
} from "../fact/index.js";

export type HistoryStep = Readonly<{
  id: FactId;
  body: HistoryBody;
  actionFacts: readonly ActionFact[];
}>;

export type HistoryState = Readonly<{
  channelId: HistoryChannelId;
  headStepId: FactId | null;
  undoStack: readonly FactId[];
  redoStack: readonly FactId[];
}>;

export function rebuildHistoryState(snapshot: FactSnapshot, channelId: HistoryChannelId): HistoryState {
  const undoStack: FactId[] = [];
  const redoStack: FactId[] = [];
  let headStepId: FactId | null = null;

  for (const step of historySteps(snapshot, channelId)) {
    applyStep(step, undoStack, redoStack);
    headStepId = step.id;
  }
  return { channelId, headStepId, undoStack, redoStack };
}

export function nextHistoryLineage(
  snapshot: FactSnapshot,
  channelId: HistoryChannelId,
  operation: HistoryOperation,
  targetStepId: FactId | null,
): ReceiptLineage {
  const state = rebuildHistoryState(snapshot, channelId);
  const expectedTarget =
    operation === "undo"
      ? (state.undoStack.at(-1) ?? null)
      : operation === "redo"
        ? (state.redoStack.at(-1) ?? null)
        : null;
  if (targetStepId !== expectedTarget) {
    throw new Error(`History ${operation} target is not the channel head: ${targetStepId}`);
  }
  return { channelId, operation, targetStepId };
}

export function historyBody(lineage: ReceiptLineage, actionFactCount: number): HistoryBody {
  if (!Number.isSafeInteger(actionFactCount) || actionFactCount < 1) {
    throw new Error("History Step must own at least one Action Fact");
  }
  return { kind: "history", ...lineage, actionFactCount };
}

export function historySteps(snapshot: FactSnapshot, channelId?: HistoryChannelId): readonly HistoryStep[] {
  const factsByReplicaSequence = new Map(
    snapshot.facts.map((fact) => [`${fact.coordinate.dot.replicaId}/${fact.coordinate.dot.sequence}`, fact]),
  );
  return snapshot.facts.flatMap((fact) => {
    if (fact.body.kind !== "history" || (channelId !== undefined && fact.body.channelId !== channelId)) {
      return [];
    }
    const actionFacts: ActionFact[] = [];
    const firstSequence = fact.coordinate.dot.sequence - fact.body.actionFactCount;
    for (let sequence = firstSequence; sequence < fact.coordinate.dot.sequence; sequence += 1) {
      const owned = factsByReplicaSequence.get(`${fact.coordinate.dot.replicaId}/${sequence}`);
      if (!owned || owned.body.kind !== "action") {
        throw new Error(`History Step does not follow its complete Action Fact batch: ${fact.id}`);
      }
      actionFacts.push(owned as ActionFact);
    }
    return [{ id: fact.id, body: fact.body, actionFacts }];
  });
}

function applyStep(step: HistoryStep, undoStack: FactId[], redoStack: FactId[]): void {
  if (step.body.operation === "normal") {
    undoStack.push(step.id);
    redoStack.length = 0;
    return;
  }
  if (step.body.operation === "undo") {
    const target = undoStack.at(-1);
    if (!target || target !== step.body.targetStepId) {
      throw new Error(`History Undo target is not the channel head: ${step.body.targetStepId}`);
    }
    undoStack.pop();
    redoStack.push(step.id);
    return;
  }
  const target = redoStack.at(-1);
  if (!target || target !== step.body.targetStepId) {
    throw new Error(`History Redo target is not the channel head: ${step.body.targetStepId}`);
  }
  redoStack.pop();
  undoStack.push(step.id);
}
