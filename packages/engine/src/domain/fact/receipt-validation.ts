import { canonicalJson } from "./canonical.js";
import { isReplicaId } from "./fact.js";
import { frontierEquals, normalizeFrontier } from "./frontier.js";
import type { AuthorityReceipt } from "./authority-types.js";
import type { Fact, WorkspaceId } from "./types.js";

export function validateReceipts(
  workspaceId: WorkspaceId,
  receipts: readonly AuthorityReceipt[],
  facts: readonly Fact[],
): void {
  const receiptCanonicals = new Map<string, string>();
  const factClaims = new Map<string, string>();
  const factsById = new Map(facts.map((fact) => [fact.id, fact]));
  for (const receipt of receipts) {
    validateReceipt(workspaceId, receipt);
    validateReceiptBatch(workspaceId, receipt, factsById);
    const key = `${receipt.replicaId}/${receipt.invocationId}`;
    const canonical = canonicalJson(receipt);
    const existing = receiptCanonicals.get(key);
    if (existing && existing !== canonical) {
      throw new Error(`Invocation ledger conflict: ${key}`);
    }
    receiptCanonicals.set(key, canonical);
    for (const factId of receipt.factIds) {
      const claimant = factClaims.get(factId);
      if (claimant && claimant !== key) {
        throw new Error(`Fact batch is claimed by multiple Invocations: ${factId}`);
      }
      factClaims.set(factId, key);
    }
  }
}

export function validatePlannedReceiptAppend(
  workspaceId: WorkspaceId,
  receipt: AuthorityReceipt,
  facts: readonly Fact[],
): void {
  validateReceipt(workspaceId, receipt);
  validateReceiptBatch(workspaceId, receipt, new Map(facts.map((fact) => [fact.id, fact])));
}

function validateReceipt(workspaceId: WorkspaceId, receipt: AuthorityReceipt): void {
  if (receipt.workspaceId !== workspaceId) {
    throw new Error(`Receipt workspace mismatch: ${receipt.invocationId}`);
  }
  if (!isReplicaId(receipt.replicaId) || !receipt.invocationId || !receipt.requestDigest) {
    throw new Error(`Malformed Invocation receipt: ${receipt.invocationId}`);
  }
  if (new Set(receipt.factIds).size !== receipt.factIds.length) {
    throw new Error(`Receipt contains duplicate Fact IDs: ${receipt.invocationId}`);
  }
  for (const [replicaId, sequence] of Object.entries(receipt.committedFrontier)) {
    if (!isReplicaId(replicaId) || !Number.isSafeInteger(sequence) || sequence < 0) {
      throw new Error(`Receipt frontier is invalid: ${receipt.invocationId}`);
    }
  }
  if (receipt.lineage) {
    if (
      (receipt.lineage.operation === "normal" && receipt.lineage.targetStepId !== null) ||
      ((receipt.lineage.operation === "undo" || receipt.lineage.operation === "redo") &&
        receipt.lineage.targetStepId === null)
    ) {
      throw new Error(`Receipt lineage is invalid: ${receipt.invocationId}`);
    }
  }
}

function validateReceiptBatch(
  workspaceId: WorkspaceId,
  receipt: AuthorityReceipt,
  facts: ReadonlyMap<string, Fact>,
): void {
  const prefix = `g1/${workspaceId}/${receipt.replicaId}/`;
  if (receipt.factIds.length === 0) {
    throw new Error(`Receipt Fact batch is empty: ${receipt.invocationId}`);
  }
  const positions = receipt.factIds.map((id) => {
    if (!id.startsWith(prefix)) {
      throw new Error(`Receipt Fact belongs to another Replica: ${receipt.invocationId}`);
    }
    const match = /^(\d+)$/.exec(id.slice(prefix.length));
    const sequence = Number(match?.[1]);
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new Error(`Receipt contains an invalid Fact identity: ${receipt.invocationId}`);
    }
    return sequence;
  });
  if (
    positions.some((sequence, index) => {
      const previous = positions[index - 1];
      return index > 0 && (previous === undefined || sequence !== previous + 1);
    })
  ) {
    throw new Error(`Receipt Fact batch is not contiguous: ${receipt.invocationId}`);
  }
  const committedSequence = receipt.committedFrontier[receipt.replicaId] ?? 0;
  if (positions.at(-1) !== committedSequence) {
    throw new Error(`Receipt frontier does not end at its Fact batch: ${receipt.invocationId}`);
  }
  const available = receipt.factIds.map((id) => facts.get(id));
  if (!available.every((fact): fact is Fact => fact !== undefined)) {
    throw new Error(`Receipt references a missing Fact: ${receipt.invocationId}`);
  }
  if (
    available.some(
      (fact, index) =>
        fact.coordinate.dot.replicaId !== receipt.replicaId || fact.coordinate.dot.sequence !== positions[index],
    )
  ) {
    throw new Error(`Receipt complete batch has a Replica mismatch: ${receipt.invocationId}`);
  }
  const historyFacts = available.filter((fact) => fact?.body.kind === "history");
  if (receipt.lineage === null) {
    if (historyFacts.length > 0) {
      throw new Error(`Receipt without lineage contains a History Step: ${receipt.invocationId}`);
    }
  } else {
    const historyFact = available.at(-1);
    if (
      historyFacts.length !== 1 ||
      historyFact?.body.kind !== "history" ||
      historyFact.body.channelId !== receipt.lineage.channelId ||
      historyFact.body.operation !== receipt.lineage.operation ||
      historyFact.body.targetStepId !== receipt.lineage.targetStepId ||
      historyFact.body.actionFactCount !== receipt.factIds.length - 1
    ) {
      throw new Error(`Receipt lineage differs from its History Step: ${receipt.invocationId}`);
    }
  }
  const last = available.at(-1)!;
  const expected = normalizeFrontier({
    ...last.coordinate.observed,
    [receipt.replicaId]: last.coordinate.dot.sequence,
  });
  if (!frontierEquals(receipt.committedFrontier, expected)) {
    throw new Error(`Receipt frontier differs from its complete Fact batch: ${receipt.invocationId}`);
  }
}
