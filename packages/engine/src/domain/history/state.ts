import type { AuthorityReceipt, HistoryChannelId, InvocationId, ReceiptLineage } from "../fact/index.js";

export type HistoryState = Readonly<{
  channelId: HistoryChannelId;
  headInvocationId: InvocationId | null;
  undoStack: readonly InvocationId[];
  redoStack: readonly InvocationId[];
}>;

export function rebuildHistoryState(receipts: readonly AuthorityReceipt[], channelId: HistoryChannelId): HistoryState {
  const channelReceipts = receipts.filter(
    (receipt): receipt is AuthorityReceipt & { lineage: ReceiptLineage } => receipt.lineage?.channelId === channelId,
  );
  const undoStack: InvocationId[] = [];
  const redoStack: InvocationId[] = [];
  let headInvocationId: InvocationId | null = null;

  for (const receipt of channelReceipts) {
    const lineage = receipt.lineage;
    applyReceipt(receipt.invocationId, lineage, undoStack, redoStack);
    headInvocationId = receipt.invocationId;
  }
  return { channelId, headInvocationId, undoStack, redoStack };
}

export function nextHistoryLineage(
  receipts: readonly AuthorityReceipt[],
  channelId: HistoryChannelId,
  operation: "normal" | "undo" | "redo",
  targetStepId: InvocationId | null,
): ReceiptLineage {
  const state = rebuildHistoryState(receipts, channelId);
  const expectedTarget =
    operation === "undo"
      ? (state.undoStack.at(-1) ?? null)
      : operation === "redo"
        ? (state.redoStack.at(-1) ?? null)
        : null;
  if (targetStepId !== expectedTarget) {
    throw new Error(`History ${operation} target is not the channel head: ${targetStepId}`);
  }
  return {
    channelId,
    operation,
    targetStepId,
  };
}

function applyReceipt(
  invocationId: InvocationId,
  lineage: ReceiptLineage,
  undoStack: InvocationId[],
  redoStack: InvocationId[],
): void {
  if (lineage.operation === "normal") {
    undoStack.push(invocationId);
    redoStack.length = 0;
    return;
  }
  if (lineage.operation === "undo") {
    const target = undoStack.at(-1);
    if (!target || target !== lineage.targetStepId) {
      throw new Error(`History Undo target is not the channel head: ${lineage.targetStepId}`);
    }
    undoStack.pop();
    redoStack.push(invocationId);
    return;
  }
  if (lineage.operation === "redo") {
    const target = redoStack.at(-1);
    if (!target || target !== lineage.targetStepId) {
      throw new Error(`History Redo target is not the channel head: ${lineage.targetStepId}`);
    }
    redoStack.pop();
    undoStack.push(invocationId);
  }
}
