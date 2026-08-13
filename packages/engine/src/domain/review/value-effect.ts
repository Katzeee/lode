import type { ContributionFact, JsonValue, PreviousValue } from "../fact/index.js";
import {
  valueKeyAddress,
  valueTargetAddress,
  type Projection,
  type ProjectionGeneration,
} from "../reconcile/index.js";

type ValueMutation = Extract<
  ContributionFact["body"]["mutation"],
  { kind: "value-set" | "value-unset" }
>;

export function valueAddress(mutation: ValueMutation): string {
  return valueKeyAddress(mutation.target, mutation.namespace, mutation.key);
}

export function valueEffect(mutation: ValueMutation, generation: ProjectionGeneration) {
  return {
    kind: "value" as const,
    targetKind: mutation.target.kind,
    targetId: mutation.target.id,
    namespace: mutation.namespace,
    key: mutation.key,
    origin: projectedValue(generation.origin, mutation),
    review: projectedValue(generation.review, mutation),
  };
}

function projectedValue(projection: Projection, mutation: ValueMutation): PreviousValue {
  if (mutation.target.kind === "node") {
    const target = projection.nodes[mutation.target.id];
    return valueState(
      mutation.namespace === "metadata" ? target?.metadata : target?.properties,
      mutation.key,
    );
  }
  if (mutation.target.kind === "occurrence") {
    const target = projection.occurrences[mutation.target.id];
    return valueState(
      mutation.namespace === "metadata" ? target?.metadata : target?.properties,
      mutation.key,
    );
  }
  const address = valueTargetAddress(mutation.target, mutation.namespace);
  return valueState(projection.addressedValues[address], mutation.key);
}

export function valueState(
  values: Readonly<Record<string, JsonValue>> | undefined,
  key: string,
): PreviousValue {
  return values && Object.hasOwn(values, key)
    ? { kind: "set", value: values[key] ?? null }
    : { kind: "unset" };
}
