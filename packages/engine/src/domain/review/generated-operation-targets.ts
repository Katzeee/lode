import { stableStringCompare, type ContributionFact, type Mutation } from "../fact/index.js";
import { supportClosure } from "../reconcile/support-closure.js";

export function generatedOperationTargets(
  targetIds: readonly string[],
  pending: ReadonlyMap<string, ContributionFact>,
  supportByContribution: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  const targets = new Set(targetIds);
  const supported = new Set(
    supportClosure([...targets], supportByContribution).filter((id) => pending.has(id)),
  );
  for (const relation of pending.values()) {
    const keys = generatedLifecycleKeys(relation.body.mutation);
    if (
      keys.length === 0 ||
      ![...supported].some((id) => {
        const lifecycle = pending.get(id);
        return (
          lifecycle !== undefined &&
          keys.includes(lifecycleKey(lifecycle.body.mutation) ?? "") &&
          lifecycle.body.actorId === relation.body.actorId &&
          lifecycle.body.intent === relation.body.intent &&
          causallyRelated(lifecycle, relation)
        );
      })
    ) {
      continue;
    }
    targets.add(relation.id);
  }
  return [...targets].sort(stableStringCompare);
}

function generatedLifecycleKeys(mutation: Mutation): readonly string[] {
  if (mutation.kind === "schema-field-add") {
    return [
      `node-create/${mutation.fieldNodeId}`,
      `occurrence-create/${mutation.fieldOccurrenceId}`,
    ];
  }
  if (mutation.kind === "schema-field-remove") {
    return [`occurrence-delete/${mutation.fieldOccurrenceId}`];
  }
  if (mutation.kind === "schema-template-node-add") {
    return [`occurrence-create/${mutation.templateOccurrenceId}`];
  }
  if (mutation.kind === "schema-template-node-remove") {
    return [`occurrence-delete/${mutation.templateOccurrenceId}`];
  }
  if (mutation.kind === "field-initialize") {
    return [
      `node-create/${mutation.fieldNodeId}`,
      `occurrence-create/${mutation.fieldOccurrenceId}`,
      ...mutation.values.flatMap((value) => [
        ...(value.kind === "text" ? [`node-create/${value.nodeId}`] : []),
        `occurrence-create/${value.occurrenceId}`,
      ]),
    ];
  }
  if (mutation.kind === "field-value-delete") {
    return [`occurrence-delete/${mutation.valueOccurrenceId}`];
  }
  if (mutation.kind === "materialized-field-delete") {
    return [`occurrence-delete/${mutation.fieldOccurrenceId}`];
  }
  return mutation.kind === "template-node-detach"
    ? [
        `node-create/${mutation.instanceNodeId}`,
        `occurrence-create/${mutation.instanceOccurrenceId}`,
      ]
    : [];
}

function lifecycleKey(mutation: Mutation): string | null {
  if (mutation.kind === "node-create") {
    return `node-create/${mutation.nodeId}`;
  }
  return mutation.kind === "occurrence-create" || mutation.kind === "occurrence-delete"
    ? `${mutation.kind}/${mutation.occurrenceId}`
    : null;
}

function causallyRelated(left: ContributionFact, right: ContributionFact): boolean {
  return observes(left, right) || observes(right, left);
}

function observes(observer: ContributionFact, observed: ContributionFact): boolean {
  const { replicaId, sequence } = observed.coordinate.dot;
  return (observer.coordinate.observed[replicaId] ?? 0) >= sequence;
}
