import {
  compareFacts,
  type ContributionFact,
  type FactSnapshot,
  type ViewMode,
} from "../fact/index.js";
import { deriveActivation } from "./support.js";
import type { ProjectionOwnerCache } from "./projection-types.js";

export function activeContributions(
  snapshot: FactSnapshot,
  view: ViewMode,
): Readonly<{ facts: readonly ContributionFact[]; cache: ProjectionOwnerCache }> {
  const activation = deriveActivation(snapshot.facts, view);
  const facts = snapshot.facts
    .filter(
      (fact): fact is ContributionFact =>
        fact.body.kind === "contribution" && activation.activeContributionIds.has(fact.id),
    )
    .sort(compareFacts);
  return {
    facts,
    cache: {
      activeContributionIds: facts.map((fact) => fact.id),
      supportPasses: activation.convergencePasses,
    },
  };
}

export function activeFactsFromCache(
  snapshot: FactSnapshot,
  previous: ProjectionOwnerCache,
  tail: readonly ContributionFact[],
): readonly ContributionFact[] {
  const ids = new Set([...previous.activeContributionIds, ...tail.map((fact) => fact.id)]);
  return snapshot.facts
    .filter(
      (fact): fact is ContributionFact => fact.body.kind === "contribution" && ids.has(fact.id),
    )
    .sort(compareFacts);
}

export function incrementalOwnerCache(
  previous: ProjectionOwnerCache,
  tail: readonly ContributionFact[],
): ProjectionOwnerCache {
  return {
    activeContributionIds: [...previous.activeContributionIds, ...tail.map((fact) => fact.id)],
    supportPasses: previous.supportPasses,
  };
}
