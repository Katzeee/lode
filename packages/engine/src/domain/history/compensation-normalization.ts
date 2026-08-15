import { compareFacts, type ContributionFact, type Mutation } from "../fact/index.js";
import type { ScopedProjection } from "../reconcile/index.js";

export function normalizeCompensationTargets(
  targets: readonly ContributionFact[],
  projection: ScopedProjection,
): readonly ContributionFact[] {
  const result: ContributionFact[] = [];
  const grouped = new Map<string, ContributionFact[]>();
  for (const target of targets) {
    const key = compensationOwner(target.body.mutation);
    if (!key) {
      result.push(target);
      continue;
    }
    const group = grouped.get(key) ?? [];
    group.push(target);
    grouped.set(key, group);
  }
  for (const group of grouped.values()) {
    result.push(...normalizeOwnerChanges(group, projection));
  }
  return result.sort(compareFacts);
}

function normalizeOwnerChanges(
  group: readonly ContributionFact[],
  projection: ScopedProjection,
): readonly ContributionFact[] {
  const ordered = [...group].sort(compareFacts);
  const lifecycle = lifecycleRepresentatives(ordered, projection);
  if (lifecycle) {
    return lifecycle;
  }
  const first = ordered[0];
  const last = ordered.at(-1);
  if (!first || !last) {
    return [];
  }
  const firstMutation = first.body.mutation;
  const lastMutation = last.body.mutation;
  return [
    {
      ...last,
      body: { ...last.body, mutation: restoreFirstPrevious(firstMutation, lastMutation) },
    },
  ];
}

function restoreFirstPrevious(first: Mutation, last: Mutation): Mutation {
  if (
    (first.kind === "value-set" || first.kind === "value-unset") &&
    (last.kind === "value-set" || last.kind === "value-unset")
  ) {
    return { ...last, previous: first.previous };
  }
  if (first.kind === "text-mark" && last.kind === "text-mark") {
    return { ...last, previous: first.previous };
  }
  if (first.kind === "occurrence-move" && last.kind === "occurrence-move") {
    return {
      ...last,
      previousParentNodeId: first.previousParentNodeId,
      previousAnchor: first.previousAnchor,
    };
  }
  return first.kind === "node-owner-set" && last.kind === "node-owner-set"
    ? { ...last, previousOwnerNodeId: first.previousOwnerNodeId }
    : last;
}

function lifecycleRepresentatives(
  ordered: readonly ContributionFact[],
  projection: ScopedProjection,
): readonly ContributionFact[] | null {
  const mutation = ordered[0]?.body.mutation;
  if (!mutation) {
    return null;
  }
  if (mutation.kind === "node-create" || mutation.kind === "node-delete" || mutation.kind === "node-restore") {
    const wanted = projection.nodes[mutation.nodeId] ? ["node-create", "node-restore"] : ["node-delete"];
    const matching = ordered.filter((fact) => wanted.includes(fact.body.mutation.kind));
    return projection.nodes[mutation.nodeId] ? matching.slice(-1) : matching;
  }
  if (
    mutation.kind === "occurrence-create" ||
    mutation.kind === "occurrence-delete" ||
    mutation.kind === "occurrence-restore"
  ) {
    const wanted = projection.occurrences[mutation.occurrenceId]
      ? ["occurrence-create", "occurrence-restore"]
      : ["occurrence-delete"];
    const matching = ordered.filter((fact) => wanted.includes(fact.body.mutation.kind));
    return projection.occurrences[mutation.occurrenceId] ? matching.slice(-1) : matching;
  }
  return null;
}

function compensationOwner(mutation: Mutation): string | null {
  if (mutation.kind === "node-create" || mutation.kind === "node-delete" || mutation.kind === "node-restore") {
    return `node-lifecycle/${mutation.nodeId}`;
  }
  if (
    mutation.kind === "occurrence-create" ||
    mutation.kind === "occurrence-delete" ||
    mutation.kind === "occurrence-restore"
  ) {
    return `occurrence-lifecycle/${mutation.occurrenceId}`;
  }
  if (mutation.kind === "value-set" || mutation.kind === "value-unset") {
    return `value/${mutation.target.kind}/${mutation.target.id}/${mutation.namespace}/${mutation.key}`;
  }
  if (mutation.kind === "text-mark") {
    return `mark/${mutation.nodeId}/${mutation.key}/${[...mutation.atomIds].sort().join("|")}`;
  }
  if (mutation.kind === "occurrence-move") {
    return `move/${mutation.occurrenceId}`;
  }
  if (mutation.kind === "node-owner-set") {
    return `owner/${mutation.nodeId}`;
  }
  if (mutation.kind === "node-type-declare") {
    return `node-type/${mutation.nodeId}`;
  }
  if (mutation.kind === "schema-apply" || mutation.kind === "schema-remove") {
    return `schema-application/${mutation.nodeId}/${mutation.schemaId}`;
  }
  if (
    mutation.kind === "schema-field-add" ||
    mutation.kind === "schema-field-remove" ||
    mutation.kind === "schema-field-configure"
  ) {
    return `schema-field/${mutation.schemaId}/${mutation.fieldDefinitionId}`;
  }
  return mutation.kind === "schema-extension-add" || mutation.kind === "schema-extension-remove"
    ? `schema-extension/${mutation.schemaId}/${mutation.baseSchemaId}`
    : null;
}
