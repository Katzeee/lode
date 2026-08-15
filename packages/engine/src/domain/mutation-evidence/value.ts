import { canonicalJson, type PreviousValue, type ValueMutation } from "../fact/index.js";
import type { ScopedProjection } from "../reconcile/index.js";
import type { MutationEvidenceFamily } from "./policy.js";

const VALUE_MUTATION_KINDS = ["value-set", "value-unset"] as const satisfies readonly ValueMutation["kind"][];

export const valueMutationEvidence = {
  key: "value",
  mutationKinds: VALUE_MUTATION_KINDS,
  complete(mutation, context) {
    const { previous, available } = context.projections();
    return completeValueMutationEvidence(mutation, previous, available);
  },
  validate(mutation, context) {
    const expected = valueMutationEvidence.complete(mutation, context);
    if (canonicalJson(expected.previous) !== canonicalJson(mutation.previous)) {
      throw new Error("Value previous evidence does not match the observed projection");
    }
  },
} satisfies MutationEvidenceFamily<(typeof VALUE_MUTATION_KINDS)[number]>;

function completeValueMutationEvidence(
  mutation: ValueMutation,
  previous: ScopedProjection,
  available: ScopedProjection,
): ValueMutation {
  if (mutation.target.kind === "node" && !available.nodes[mutation.target.id]) {
    throw new Error("Value target Node is absent from the observed projection");
  }
  if (mutation.target.kind === "occurrence" && !available.occurrences[mutation.target.id]) {
    throw new Error("Value target Occurrence is absent from the observed projection");
  }
  return { ...mutation, previous: previousValue(readValue(previous, mutation)) };
}

function readValue(projection: ScopedProjection, mutation: ValueMutation) {
  if (mutation.target.kind === "node") {
    const node = projection.nodes[mutation.target.id];
    return mutation.namespace === "metadata" ? node?.metadata[mutation.key] : node?.properties[mutation.key];
  }
  const occurrence = projection.occurrences[mutation.target.id];
  return mutation.namespace === "metadata" ? occurrence?.metadata[mutation.key] : occurrence?.properties[mutation.key];
}

function previousValue(value: ReturnType<typeof readValue>): PreviousValue {
  return value === undefined ? { kind: "unset" } : { kind: "set", value };
}
