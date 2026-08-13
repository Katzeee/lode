import type { Mutation, PreviousValue } from "../../domain/fact/index.js";
import type { Projection } from "../../domain/reconcile/index.js";

type ValueMutation = Extract<Mutation, { kind: "value-set" | "value-unset" }>;

export function prepareValueMutation(
  mutation: ValueMutation,
  previous: Projection,
  available: Projection,
): Mutation {
  if (mutation.target.kind === "node" && !available.nodes[mutation.target.id]) {
    throw new Error(`Value target Node does not exist: ${mutation.target.id}`);
  }
  if (mutation.target.kind === "occurrence" && !available.occurrences[mutation.target.id]) {
    throw new Error(`Value target Occurrence does not exist: ${mutation.target.id}`);
  }
  return { ...mutation, previous: previousValue(readValue(previous, mutation)) };
}

function readValue(projection: Projection, mutation: ValueMutation) {
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
