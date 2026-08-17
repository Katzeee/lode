import type { Mutation } from "./types.js";
import {
  validateSharedDefaultViewDefinitionMode,
  validateSharedDefaultViewDefinitionMutation,
  validateSharedDefaultViewDefinitionOptions,
  validateSharedDefaultViewDefinitionSortByName,
} from "./view-definition-validation.js";

export function validateViewMutation(
  mutation: Extract<Mutation, { kind: `shared-default-view-definition-${string}` }>,
  factIdentity: string,
): void {
  if (
    mutation.kind === "shared-default-view-definition-attach" ||
    mutation.kind === "shared-default-view-definition-detach"
  ) {
    validateSharedDefaultViewDefinitionMutation(mutation, factIdentity);
  } else if (mutation.kind === "shared-default-view-definition-mode-set") {
    validateSharedDefaultViewDefinitionMode(mutation, factIdentity);
  } else if (mutation.kind === "shared-default-view-definition-sort-by-name-set") {
    validateSharedDefaultViewDefinitionSortByName(mutation, factIdentity);
  } else {
    validateSharedDefaultViewDefinitionOptions(mutation, factIdentity);
  }
}
