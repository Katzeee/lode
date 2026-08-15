import {
  canonicalJson,
  compareFacts,
  type ContributionFact,
  type JsonValue,
  type PreviousValue,
  type ValueMutation,
} from "../fact/index.js";
import {
  impactAddress,
  valueKeyAddress,
  valueTargetAddress,
  type ScopedProjection,
  type ScopedProjectionGeneration,
} from "../reconcile/index.js";
import type { HunkCandidate, ReviewFamilyRule } from "./review-family.js";
import { associatedNodeScope, associatedOccurrenceScopes, reviewScope } from "./review-scope.js";

const VALUE_MUTATION_KINDS = ["value-set", "value-unset"] as const;

export const valueReviewFamily = {
  key: "value",
  mutationKinds: VALUE_MUTATION_KINDS,
  scopes(fact, context) {
    const mutation = fact.body.mutation;
    if (!isValueMutation(mutation)) {
      throw new Error("Value Review family received another Mutation family");
    }
    return [
      reviewScope("value", mutation.target.kind, mutation.target.id, mutation.namespace, mutation.key),
      ...(mutation.target.kind === "node"
        ? [associatedNodeScope(mutation.target.id)]
        : associatedOccurrenceScopes(mutation.target.id, context.occurrenceNodeId(mutation.target.id) ?? undefined)),
    ];
  },
  candidates: ({ generation, pending }) => valueCandidates(generation, pending),
  effect(fact, _targets, generation) {
    const mutation = fact.body.mutation;
    if (!isValueMutation(mutation)) {
      throw new Error("Value Review family received another Mutation family");
    }
    const effect = valueEffect(mutation, generation);
    return canonicalJson(effect.origin) === canonicalJson(effect.review)
      ? null
      : { identity: `value/${valueAddress(mutation)}`, effect };
  },
  addImpacts(impacts, targets, generation) {
    for (const fact of targets) {
      const mutation = fact.body.mutation;
      if (isValueMutation(mutation)) {
        addValueImpacts(impacts, mutation, generation);
      }
    }
  },
} satisfies ReviewFamilyRule;

function valueCandidates(
  generation: ScopedProjectionGeneration,
  pending: ReadonlyMap<string, ContributionFact>,
): readonly HunkCandidate[] {
  const groups = new Map<string, ContributionFact[]>();
  for (const fact of pending.values()) {
    const mutation = fact.body.mutation;
    if (!isValueMutation(mutation)) {
      continue;
    }
    const address = valueAddress(mutation);
    const group = groups.get(address) ?? [];
    group.push(fact);
    groups.set(address, group);
  }
  return [...groups.entries()]
    .filter(([, facts]) => {
      const mutation = facts.at(-1)?.body.mutation;
      if (!mutation || !isValueMutation(mutation)) {
        return false;
      }
      const effect = valueEffect(mutation, generation);
      return canonicalJson(effect.origin) !== canonicalJson(effect.review);
    })
    .map(([address, facts]) => ({
      diffSpace: { kind: "value" as const, identity: address },
      targets: [...facts].sort(compareFacts).map((fact) => fact.id),
      bridges: [],
    }));
}

function valueAddress(mutation: ValueMutation): string {
  return valueKeyAddress(mutation.target, mutation.namespace, mutation.key);
}

function valueEffect(mutation: ValueMutation, generation: ScopedProjectionGeneration) {
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

function projectedValue(projection: ScopedProjection, mutation: ValueMutation): PreviousValue {
  if (mutation.target.kind === "node") {
    const target = projection.nodes[mutation.target.id];
    return valueState(mutation.namespace === "metadata" ? target?.metadata : target?.properties, mutation.key);
  }
  if (mutation.target.kind === "occurrence") {
    const target = projection.occurrences[mutation.target.id];
    return valueState(mutation.namespace === "metadata" ? target?.metadata : target?.properties, mutation.key);
  }
  return valueState(projection.addressedValues[valueTargetAddress(mutation.target, mutation.namespace)], mutation.key);
}

function valueState(values: Readonly<Record<string, JsonValue>> | undefined, key: string): PreviousValue {
  return values && Object.hasOwn(values, key) ? { kind: "set", value: values[key] ?? null } : { kind: "unset" };
}

function addValueImpacts(impacts: Set<string>, mutation: ValueMutation, generation: ScopedProjectionGeneration): void {
  if (mutation.target.kind === "node") {
    const occurrenceIds = [
      ...Object.values(generation.origin.occurrences),
      ...Object.values(generation.review.occurrences),
    ]
      .filter((occurrence) => occurrence.nodeId === mutation.target.id)
      .map((occurrence) => occurrence.occurrenceId);
    occurrenceIds.forEach((occurrenceId) => impacts.add(occurrenceId));
    return;
  }
  if (mutation.target.kind === "occurrence") {
    impacts.add(mutation.target.id);
    return;
  }
  impacts.add(impactAddress("value-target", mutation.target.kind, mutation.target.id));
}

function isValueMutation(mutation: ContributionFact["body"]["mutation"]): mutation is ValueMutation {
  return mutation.kind === "value-set" || mutation.kind === "value-unset";
}
