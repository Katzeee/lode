import type { AuthoredAction } from "./types.js";
import {
  contributionOwnersFromContributions,
  producersFromContributions,
  requirementsFromContributions,
} from "./action-contribution-derivation.js";
import { authoredActionContributions } from "./action-contributions.js";

export function contributionOwnerNodeIds(action: AuthoredAction): readonly string[] {
  return contributionOwnersFromContributions(authoredActionContributions(action));
}

export function actionIdentityProducers(action: AuthoredAction) {
  return producersFromContributions(authoredActionContributions(action));
}

export function actionIdentityRequirements(action: AuthoredAction) {
  return requirementsFromContributions(authoredActionContributions(action));
}

export { factActionContributions } from "./action-contributions.js";
export type { CollectionContribution, CollectionName, SemanticIdentity } from "./action-contribution-types.js";
export { SELF_FACT_ACTION } from "./action-contribution-types.js";
