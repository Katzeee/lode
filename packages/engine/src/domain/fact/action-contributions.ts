import { catalogActionContributions } from "./action-catalog.js";
import type { AuthoredAction, FactAction } from "./types.js";
import type { SemanticContribution } from "./action-contribution-types.js";

const contributionsByAction = new WeakMap<AuthoredAction, readonly SemanticContribution[]>();

export function authoredActionContributions(action: AuthoredAction): readonly SemanticContribution[] {
  const cached = contributionsByAction.get(action);
  if (cached !== undefined) {
    return cached;
  }
  const contributions = catalogActionContributions(action);
  contributionsByAction.set(action, contributions);
  return contributions;
}

export function factActionContributions(fact: FactAction): readonly SemanticContribution[] {
  return authoredActionContributions(fact.action);
}
