import { compareFacts, type ContributionFact, type Mutation } from "../fact/index.js";
import type { ScopedProjection } from "../reconcile/index.js";
import { nodeLocation } from "../reconcile/node-graph.js";

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
    const location = nodeLocation(projection.identity.workspaceNodeId, projection, mutation.nodeId);
    const active = location === "active" || (location === "absent" && projection.nodeOwners[mutation.nodeId] != null);
    const wanted = active ? ["node-create", "node-restore"] : ["node-delete"];
    const matching = ordered.filter((fact) => wanted.includes(fact.body.mutation.kind));
    return active ? matching.slice(-1) : matching;
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
  if (mutation.kind === "text-mark") {
    return `mark/${mutation.nodeId}/${mutation.key}/${[...mutation.atomIds].sort().join("|")}`;
  }
  if (mutation.kind === "occurrence-move") {
    return `move/${mutation.occurrenceId}`;
  }
  if (mutation.kind === "node-owner-set") {
    return `owner/${mutation.nodeId}`;
  }
  if (mutation.kind === "intrinsic-node-type-declare") {
    return `intrinsic-node-type/${mutation.nodeId}`;
  }
  if (mutation.kind === "supertag-apply" || mutation.kind === "supertag-remove") {
    return `supertag-application/${mutation.applicationNodeId}`;
  }
  return mutation.kind === "supertag-extension-add" || mutation.kind === "supertag-extension-remove"
    ? `supertag-extension/${mutation.supertagId}/${mutation.baseSupertagId}`
    : null;
}
