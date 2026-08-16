import type { MetanodeMutation } from "../fact/index.js";
import type { MutationEvidenceFamily } from "./policy.js";

const METANODE_MUTATION_KINDS = ["metanode-attach"] as const satisfies readonly MetanodeMutation["kind"][];

export const metanodeMutationEvidence = {
  key: "configuration",
  mutationKinds: METANODE_MUTATION_KINDS,
  complete(mutation) {
    return mutation;
  },
  validate() {},
} satisfies MutationEvidenceFamily<(typeof METANODE_MUTATION_KINDS)[number]>;
