import { pendingProposalActivation } from "../activation/index.js";
import {
  canonicalJson,
  compareFacts,
  stableStringCompare,
  type ContributionFact,
  type FactSnapshot,
} from "../fact/index.js";
import type { ScopedProjection } from "../reconcile/index.js";
import { reviewPaginationScopeKeys } from "./review-plan.js";

export type ReviewReadModel = Readonly<{
  scopes: Readonly<Record<string, readonly string[]>>;
  supportByContribution: Readonly<Record<string, readonly string[]>>;
}>;

export function createReviewReadModel(
  snapshot: FactSnapshot,
  review: Pick<ScopedProjection, "occurrences">,
): ReviewReadModel {
  const activation = pendingProposalActivation(snapshot);
  const scopes = reviewPaginationScopes(
    activation.pending,
    (occurrenceId) => review.occurrences[occurrenceId]?.nodeId ?? null,
  );
  return {
    scopes: Object.fromEntries([...scopes].map(([identity, facts]) => [identity, facts.map((fact) => fact.id)])),
    supportByContribution: Object.fromEntries(
      [...activation.pending.keys()]
        .sort(stableStringCompare)
        .map((id) => [id, activation.supportByContribution.get(id) ?? []]),
    ),
  };
}

function reviewPaginationScopes(
  pending: ReadonlyMap<string, ContributionFact>,
  occurrenceNodeId: (occurrenceId: string) => string | null,
): ReadonlyMap<string, readonly ContributionFact[]> {
  const groups: { keys: Set<string>; facts: ContributionFact[] }[] = [];
  for (const fact of pending.values()) {
    const keys = new Set(reviewPaginationScopeKeys(fact, occurrenceNodeId));
    const matching = groups
      .map((group, index) => ({ group, index }))
      .filter(({ group }) => [...keys].some((key) => group.keys.has(key)));
    const first = matching[0];
    if (!first) {
      groups.push({ keys, facts: [fact] });
      continue;
    }
    first.group.facts.push(fact);
    keys.forEach((key) => first.group.keys.add(key));
    for (const { group, index } of matching.slice(1).reverse()) {
      group.keys.forEach((key) => first.group.keys.add(key));
      first.group.facts.push(...group.facts);
      groups.splice(index, 1);
    }
  }
  return new Map(
    groups.map((group) => [canonicalJson([...group.keys].sort(stableStringCompare)), group.facts.sort(compareFacts)]),
  );
}
