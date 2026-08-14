import type { PreviousValue, ValueMutation } from "../fact/index.js";
import type { ScopedProjection } from "../reconcile/index.js";

export function completeValueMutationEvidence(
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
    return mutation.namespace === "metadata"
      ? node?.metadata[mutation.key]
      : node?.properties[mutation.key];
  }
  const occurrence = projection.occurrences[mutation.target.id];
  return mutation.namespace === "metadata"
    ? occurrence?.metadata[mutation.key]
    : occurrence?.properties[mutation.key];
}

function previousValue(value: ReturnType<typeof readValue>): PreviousValue {
  return value === undefined ? { kind: "unset" } : { kind: "set", value };
}
