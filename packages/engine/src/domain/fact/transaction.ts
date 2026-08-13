import { stableStringCompare } from "./canonical.js";
import type { Fact, FactTransaction } from "./types.js";

export type FactTransactionSet = Readonly<{
  complete: readonly FactTransaction[];
  pendingTransactionIds: readonly string[];
}>;

export function collectFactTransactions(facts: Iterable<Fact>): FactTransactionSet {
  const grouped = new Map<string, Fact[]>();
  for (const fact of facts) {
    const group = grouped.get(fact.transaction.transactionId) ?? [];
    group.push(fact);
    grouped.set(fact.transaction.transactionId, group);
  }

  const complete: FactTransaction[] = [];
  const pendingTransactionIds: string[] = [];
  for (const [transactionId, members] of grouped) {
    const ordered = [...members].sort(
      (left, right) => left.transaction.index - right.transaction.index,
    );
    validateConsistentTransaction(transactionId, ordered);
    const size = ordered[0]?.transaction.size ?? 0;
    if (ordered.length !== size) {
      pendingTransactionIds.push(transactionId);
      continue;
    }
    validateCompleteTransaction(transactionId, ordered);
    complete.push({ transactionId, facts: ordered });
  }
  complete.sort((left, right) => {
    const leftFact = left.facts[0];
    const rightFact = right.facts[0];
    if (!leftFact || !rightFact) {
      return left.facts.length - right.facts.length;
    }
    return (
      leftFact.coordinate.lamport - rightFact.coordinate.lamport ||
      stableStringCompare(leftFact.coordinate.dot.replicaId, rightFact.coordinate.dot.replicaId) ||
      leftFact.coordinate.dot.sequence - rightFact.coordinate.dot.sequence
    );
  });
  pendingTransactionIds.sort(stableStringCompare);
  return { complete, pendingTransactionIds };
}

function validateConsistentTransaction(transactionId: string, facts: readonly Fact[]): void {
  const first = facts[0];
  if (!first) {
    throw new Error(`Fact transaction is empty: ${transactionId}`);
  }
  const indexes = new Set<number>();
  for (const fact of facts) {
    if (
      fact.transaction.transactionId !== transactionId ||
      fact.transaction.size !== first.transaction.size
    ) {
      throw new Error(`Fact transaction metadata conflicts: ${transactionId}`);
    }
    if (indexes.has(fact.transaction.index)) {
      throw new Error(`Fact transaction repeats an index: ${transactionId}`);
    }
    indexes.add(fact.transaction.index);
  }
}

function validateCompleteTransaction(transactionId: string, facts: readonly Fact[]): void {
  const first = facts[0];
  if (!first) {
    throw new Error(`Fact transaction is empty: ${transactionId}`);
  }
  for (const [index, fact] of facts.entries()) {
    if (
      fact.transaction.index !== index ||
      fact.coordinate.dot.replicaId !== first.coordinate.dot.replicaId ||
      fact.coordinate.dot.sequence !== first.coordinate.dot.sequence + index
    ) {
      throw new Error(`Fact transaction is not a contiguous Replica sequence: ${transactionId}`);
    }
    if (
      index > 0 &&
      (fact.coordinate.observed[first.coordinate.dot.replicaId] ?? 0) !==
        fact.coordinate.dot.sequence - 1
    ) {
      throw new Error(`Fact transaction member does not observe its predecessor: ${transactionId}`);
    }
  }
}
