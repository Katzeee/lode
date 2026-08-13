import type { JsonValue, Mutation } from "../../domain/fact/index.js";
import type { MutableProjection } from "./planning-projection-mutation.js";

export function applyPlanningValueMutation(
  projection: MutableProjection,
  mutation: Extract<Mutation, { kind: "value-set" | "value-unset" }>,
): void {
  const values = mutableValues(projection, mutation);
  if (!values) {
    return;
  }
  if (mutation.kind === "value-set") {
    values[mutation.key] = mutation.value;
  } else {
    delete values[mutation.key];
  }
}

export function withoutValue(
  values: Readonly<Record<string, JsonValue>>,
  key: string,
): Record<string, JsonValue> {
  const next = { ...values };
  delete next[key];
  return next;
}

function mutableValues(
  projection: MutableProjection,
  mutation: Extract<Mutation, { kind: "value-set" | "value-unset" }>,
): Record<string, JsonValue> | null {
  if (mutation.target.kind === "node") {
    const node = projection.nodes[mutation.target.id];
    return node ? (mutation.namespace === "metadata" ? node.metadata : node.properties) : null;
  }
  if (mutation.target.kind === "occurrence") {
    const occurrence = projection.occurrences[mutation.target.id];
    if (!occurrence) {
      return null;
    }
    const values = {
      ...(mutation.namespace === "metadata" ? occurrence.metadata : occurrence.properties),
    };
    projection.occurrences[mutation.target.id] = {
      ...occurrence,
      [mutation.namespace === "metadata" ? "metadata" : "properties"]: values,
    };
    return values;
  }
  return null;
}
