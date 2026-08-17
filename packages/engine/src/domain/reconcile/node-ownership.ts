import { stableStringCompare, type ContributionFact } from "../fact/index.js";
import type { MutableNode } from "./projection-state.js";

export function projectNodeOwners(
  workspaceNodeId: string,
  active: readonly ContributionFact[],
  nodes: ReadonlyMap<string, MutableNode>,
): Readonly<Record<string, string | null>> {
  if (!nodes.has(workspaceNodeId)) {
    return {};
  }

  const owners = new Map<string, string | null>([[workspaceNodeId, null]]);
  for (const fact of active) {
    const mutation = fact.body.mutation;
    if (
      mutation.kind !== "node-owner-set" ||
      !nodes.has(mutation.nodeId) ||
      (mutation.ownerNodeId !== null && !nodes.has(mutation.ownerNodeId)) ||
      mutation.nodeId === workspaceNodeId
    ) {
      continue;
    }
    const currentOwnerNodeId = owners.get(mutation.nodeId);
    if (
      mutation.previousOwnerNodeId === currentOwnerNodeId ||
      (mutation.previousOwnerNodeId === null && currentOwnerNodeId === undefined)
    ) {
      owners.set(mutation.nodeId, mutation.ownerNodeId);
    }
  }

  return Object.fromEntries([...owners].sort(([left], [right]) => stableStringCompare(left, right)));
}
