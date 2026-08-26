import type { AuthoredAction } from "../types.js";
import {
  contributionOwnersFromContributions,
  producersFromContributions,
  requirementsFromContributions,
} from "./derivation.js";
import { authoredActionContributions } from "./contributions.js";

export function contributionOwnerNodeIds(action: AuthoredAction): readonly string[] {
  return contributionOwnersFromContributions(authoredActionContributions(action));
}

export function actionIdentityProducers(action: AuthoredAction) {
  return producersFromContributions(authoredActionContributions(action));
}

export function actionIdentityRequirements(action: AuthoredAction) {
  return requirementsFromContributions(authoredActionContributions(action));
}

export { authoredActionContributions, factActionContributions } from "./contributions.js";
export type {
  CollectionContribution,
  CollectionName,
  IdentityContribution,
  IdentityRole,
  SemanticContribution,
  SemanticIdentity,
} from "./types.js";
export { SELF_FACT_ACTION } from "./types.js";
