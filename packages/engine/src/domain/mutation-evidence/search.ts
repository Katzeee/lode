import type { SearchMutation } from "../fact/index.js";
import type { MutationEvidenceFamily } from "./policy.js";

const SEARCH_MUTATION_KINDS = [
  "search-supertag-clause-attach",
  "search-field-clause-attach",
] as const satisfies readonly SearchMutation["kind"][];

export const searchMutationEvidence = {
  key: "search",
  mutationKinds: SEARCH_MUTATION_KINDS,
  complete(mutation) {
    return mutation;
  },
  validate() {},
} satisfies MutationEvidenceFamily<(typeof SEARCH_MUTATION_KINDS)[number]>;
