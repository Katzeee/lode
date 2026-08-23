import { compareCausalOrder, type FactAction, type AuthoredAction } from "../fact/index.js";
import type { ScopedProjection } from "../reconcile/index.js";
import { nodeLocation } from "../reconcile/node-graph.js";

export function normalizeCompensationTargets(
  targets: readonly FactAction[],
  projection: ScopedProjection,
): readonly FactAction[] {
  const result: FactAction[] = [];
  const grouped = new Map<string, FactAction[]>();
  for (const target of targets) {
    const key = compensationOwner(target.action);
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
  return result.sort(compareCausalOrder);
}

function normalizeOwnerChanges(group: readonly FactAction[], projection: ScopedProjection): readonly FactAction[] {
  const ordered = [...group].sort(compareCausalOrder);
  const lifecycle = lifecycleRepresentatives(ordered, projection);
  if (lifecycle) {
    return lifecycle;
  }
  const first = ordered[0];
  const last = ordered.at(-1);
  if (!first || !last) {
    return [];
  }
  return [last];
}

function lifecycleRepresentatives(
  ordered: readonly FactAction[],
  projection: ScopedProjection,
): readonly FactAction[] | null {
  const authoredAction = ordered[0]?.action;
  if (!authoredAction) {
    return null;
  }
  if (
    authoredAction.kind === "node-create" ||
    authoredAction.kind === "node-trash" ||
    authoredAction.kind === "node-restore"
  ) {
    const location = nodeLocation(projection.identity.workspaceNodeId, projection, authoredAction.nodeId);
    const active =
      location === "active" || (location === "absent" && projection.nodeOwners[authoredAction.nodeId] != null);
    const wanted = active ? ["node-create", "node-restore"] : ["node-trash"];
    const matching = ordered.filter((fact) => wanted.includes(fact.action.kind));
    return active ? matching.slice(-1) : matching;
  }
  if (authoredAction.kind === "placement-create" || authoredAction.kind === "placement-remove") {
    const wanted = projection.occurrences[authoredAction.placementId] ? ["placement-create"] : ["placement-remove"];
    const matching = ordered.filter((fact) => wanted.includes(fact.action.kind));
    return projection.occurrences[authoredAction.placementId] ? matching.slice(-1) : matching;
  }
  return null;
}

function compensationOwner(authoredAction: AuthoredAction): string | null {
  if (
    authoredAction.kind === "node-create" ||
    authoredAction.kind === "node-trash" ||
    authoredAction.kind === "node-restore"
  ) {
    return `node-lifecycle/${authoredAction.nodeId}`;
  }
  if (authoredAction.kind === "placement-create" || authoredAction.kind === "placement-remove") {
    return `placement-lifecycle/${authoredAction.placementId}`;
  }
  if (authoredAction.kind === "rich-text-mark") {
    return `mark/${authoredAction.nodeId}/${authoredAction.key}/${[...authoredAction.atomIds].sort().join("|")}`;
  }
  if (authoredAction.kind === "placement-move") {
    return `move/${authoredAction.placementId}`;
  }
  if (authoredAction.kind === "supertag-application-add" || authoredAction.kind === "supertag-membership-remove") {
    return `supertag-membership/${authoredAction.hostNodeId}/${authoredAction.supertagId}`;
  }
  return authoredAction.kind === "supertag-extension-add" || authoredAction.kind === "supertag-extension-remove"
    ? `supertag-extension/${authoredAction.supertagId}/${authoredAction.baseSupertagId}`
    : null;
}
