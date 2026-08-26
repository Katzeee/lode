import { relationsFromContributions } from "./action-semantics/derivation.js";
import { authoredActionContributions } from "./action-semantics/contributions.js";
import type { AuthoredAction } from "./types.js";
import type { ActionRelations } from "./action-relation-collection.js";

export function actionRelations(action: AuthoredAction): ActionRelations {
  return relationsFromContributions(authoredActionContributions(action));
}
