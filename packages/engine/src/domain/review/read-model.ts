import {
  canonicalJson,
  compareCausalOrder,
  factActionsFromFacts,
  stableStringCompare,
  type FactAction,
  type FactActionId,
  type FactSnapshot,
} from "../fact/index.js";
import type { ProjectionGeneration } from "../reconcile/index.js";
import { reviewPaginationScopeKeys } from "./review-plan.js";

export type ReviewReadModel = Readonly<{
  scopes: Readonly<Record<string, readonly FactActionId[]>>;
  supportByAction: Readonly<Record<string, readonly FactActionId[]>>;
}>;

export function createReviewReadModel(snapshot: FactSnapshot, generation: ProjectionGeneration): ReviewReadModel {
  const originActive = new Set(generation.activations.origin.activeActionIds);
  const reviewActive = new Set(generation.activations.review.activeActionIds);
  const pending = new Map(
    factActionsFromFacts(snapshot.facts)
      .filter((action) => action.intent === "proposal" && reviewActive.has(action.id) && !originActive.has(action.id))
      .map((action) => [action.id, action]),
  );
  const scopes = reviewPaginationScopes(
    pending,
    (occurrenceId) =>
      generation.origin.occurrences[occurrenceId] ?? generation.review.occurrences[occurrenceId] ?? null,
  );
  return {
    scopes: Object.fromEntries([...scopes].map(([identity, facts]) => [identity, facts.map((fact) => fact.id)])),
    supportByAction: Object.fromEntries(
      [...pending.keys()]
        .sort(stableStringCompare)
        .map((id) => [id, generation.activations.review.supportByAction[id] ?? []]),
    ),
  };
}

function reviewPaginationScopes(
  pending: ReadonlyMap<FactAction["id"], FactAction>,
  occurrence: (occurrenceId: string) => Readonly<{ nodeId: string; parentNodeId: string }> | null,
): ReadonlyMap<string, readonly FactAction[]> {
  const groups: { keys: Set<string>; facts: FactAction[] }[] = [];
  for (const fact of pending.values()) {
    const keys = new Set(reviewPaginationScopeKeys(fact, occurrence));
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
    groups.map((group) => [
      canonicalJson([...group.keys].sort(stableStringCompare)),
      group.facts.sort(compareCausalOrder),
    ]),
  );
}
