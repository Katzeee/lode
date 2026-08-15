import { compareFacts, type ContributionFact } from "../fact/index.js";

export function nodeCreationPlacements(pending: ReadonlyMap<string, ContributionFact>): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const creation of pending.values()) {
    if (creation.body.mutation.kind !== "node-create") {
      continue;
    }
    const nodeId = creation.body.mutation.nodeId;
    const placement = [...pending.values()]
      .filter(
        (fact) =>
          fact.transaction.transactionId === creation.transaction.transactionId &&
          fact.body.mutation.kind === "occurrence-create" &&
          fact.body.mutation.nodeId === nodeId,
      )
      .sort(compareFacts)[0];
    if (placement) {
      result.set(nodeId, placement.id);
    }
  }
  return result;
}
