import type { ContributionFact } from "../fact/index.js";

export function addTransactionSupport(
  contributions: readonly ContributionFact[],
  supportByContribution: Map<string, readonly string[]>,
): void {
  const transactions = new Map<string, ContributionFact[]>();
  for (const fact of contributions) {
    const members = transactions.get(fact.transaction.transactionId) ?? [];
    members.push(fact);
    transactions.set(fact.transaction.transactionId, members);
  }
  for (const members of transactions.values()) {
    if (members.length < 2) {
      continue;
    }
    for (const [index, fact] of members.entries()) {
      const next = members[(index + 1) % members.length];
      if (!next) {
        throw new Error("Fact transaction support cycle is incomplete");
      }
      supportByContribution.set(fact.id, [...new Set([...(supportByContribution.get(fact.id) ?? []), next.id])]);
    }
  }
}
