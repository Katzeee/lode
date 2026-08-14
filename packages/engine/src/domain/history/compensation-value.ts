import {
  canonicalJson,
  compareFacts,
  type ContributionFact,
  type JsonValue,
  type ValueMutation,
} from "../fact/index.js";
import { valueTargetAddress, type ScopedProjection } from "../reconcile/index.js";
import { noCompensation, valueState, type CompensationStep } from "./compensation-types.js";

export function compensateValueMutation(
  target: ContributionFact,
  activeFacts: readonly ContributionFact[],
  projection: ScopedProjection,
): CompensationStep {
  const mutation = target.body.mutation;
  if (mutation.kind !== "value-set" && mutation.kind !== "value-unset") {
    return noCompensation();
  }
  if (hasLaterWinner(target, activeFacts)) {
    return noCompensation();
  }
  if (mutation.previous === undefined) {
    return { kind: "stale", reason: "Value mutation lacks its previous value" };
  }
  const current = readValue(projection, mutation);
  const targetValue = mutation.kind === "value-set" ? mutation.value : undefined;
  const targetStillVisible =
    mutation.kind === "value-set"
      ? current.present && canonicalJson(current.value) === canonicalJson(mutation.value)
      : !current.present && valueTargetExists(projection, mutation);
  if (!targetStillVisible) {
    return noCompensation();
  }
  return {
    kind: "ready",
    mutations: [
      mutation.previous.kind === "unset"
        ? {
            kind: "value-unset",
            target: mutation.target,
            namespace: mutation.namespace,
            key: mutation.key,
            previous:
              targetValue === undefined ? { kind: "unset" } : { kind: "set", value: targetValue },
          }
        : {
            ...mutation,
            kind: "value-set",
            value: mutation.previous.value,
            previous:
              targetValue === undefined ? { kind: "unset" } : { kind: "set", value: targetValue },
          },
    ],
  };
}

function hasLaterWinner(target: ContributionFact, activeFacts: readonly ContributionFact[]) {
  const mutation = target.body.mutation;
  if (mutation.kind !== "value-set" && mutation.kind !== "value-unset") {
    return false;
  }
  return activeFacts.some((fact) => {
    const candidate = fact.body.mutation;
    return (
      compareFacts(target, fact) < 0 &&
      (candidate.kind === "value-set" || candidate.kind === "value-unset") &&
      candidate.target.kind === mutation.target.kind &&
      candidate.target.id === mutation.target.id &&
      candidate.namespace === mutation.namespace &&
      candidate.key === mutation.key
    );
  });
}

function readValue(
  projection: ScopedProjection,
  mutation: ValueMutation,
): Readonly<{ present: boolean; value?: JsonValue }> {
  if (mutation.target.kind === "node") {
    const node = projection.nodes[mutation.target.id];
    return valueState(
      mutation.namespace === "metadata" ? node?.metadata : node?.properties,
      mutation.key,
    );
  }
  if (mutation.target.kind === "occurrence") {
    const occurrence = projection.occurrences[mutation.target.id];
    return valueState(
      mutation.namespace === "metadata" ? occurrence?.metadata : occurrence?.properties,
      mutation.key,
    );
  }
  return valueState(
    projection.addressedValues[valueTargetAddress(mutation.target, mutation.namespace)],
    mutation.key,
  );
}

function valueTargetExists(projection: ScopedProjection, mutation: ValueMutation): boolean {
  if (mutation.target.kind === "node") {
    return projection.nodes[mutation.target.id] !== undefined;
  }
  if (mutation.target.kind === "occurrence") {
    return projection.occurrences[mutation.target.id] !== undefined;
  }
  return true;
}
