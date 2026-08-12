import type {
  AuthorityReceipt,
  HistoryChannelId,
  InvocationId,
  ReceiptLineage,
} from "../fact/index.js";

export type HistoryState = Readonly<{
  channelId: HistoryChannelId;
  headInvocationId: InvocationId | null;
  headOrdinal: number;
  undoStack: readonly InvocationId[];
  redoStack: readonly InvocationId[];
}>;

export function rebuildHistoryState(
  receipts: readonly AuthorityReceipt[],
  channelId: HistoryChannelId,
): HistoryState {
  const channelReceipts = receipts
    .filter(
      (receipt): receipt is AuthorityReceipt & { lineage: ReceiptLineage } =>
        receipt.lineage?.channelId === channelId,
    )
    .sort((left, right) => left.lineage.ordinal - right.lineage.ordinal);
  const undoStack: InvocationId[] = [];
  const redoStack: InvocationId[] = [];
  let headInvocationId: InvocationId | null = null;
  let headOrdinal = 0;

  for (const receipt of channelReceipts) {
    const lineage = receipt.lineage;
    if (lineage.ordinal !== headOrdinal + 1) {
      throw new Error(`History ordinal gap in channel ${channelId}`);
    }
    if (lineage.parentStepId !== headInvocationId) {
      throw new Error(`History parent mismatch in channel ${channelId}`);
    }
    applyReceipt(receipt.invocationId, lineage, undoStack, redoStack);
    headInvocationId = receipt.invocationId;
    headOrdinal = lineage.ordinal;
  }
  return { channelId, headInvocationId, headOrdinal, undoStack, redoStack };
}

export function nextHistoryLineage(
  receipts: readonly AuthorityReceipt[],
  channelId: HistoryChannelId,
  operation: "normal" | "undo" | "redo",
  targetStepId: InvocationId | null,
): ReceiptLineage {
  const state = rebuildHistoryState(receipts, channelId);
  return {
    channelId,
    ordinal: state.headOrdinal + 1,
    parentStepId: state.headInvocationId,
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
