import type { ViewMode } from "../../domain/fact/index.js";
import type { ProjectionGenerationStore } from "./proposal-workspace-types.js";

export async function readOwnerClosure(
  store: ProjectionGenerationStore,
  generationId: string,
  view: ViewMode,
  initialNodeIds: ReadonlySet<string>,
): Promise<Record<string, unknown>> {
  const owners: Record<string, unknown> = {};
  const visited = new Set<string>();
  let frontier = [...initialNodeIds];
  const maximumDepth = 4_096;
  for (let depth = 0; frontier.length > 0; depth += 1) {
    if (depth >= maximumDepth) {
      throw new Error("Node ownership exceeds the state-dependent read bound");
    }
    const wanted = frontier.filter((nodeId) => !visited.has(nodeId));
    if (wanted.length === 0) {
      break;
    }
    wanted.forEach((nodeId) => visited.add(nodeId));
    const batch = await store.read(generationId, view, "nodeOwners", wanted);
    const current = Object.fromEntries(batch.entries.map((entry) => [entry.identity, entry.value]));
    Object.assign(owners, current);
    frontier = Object.values(current).filter(
      (ownerNodeId): ownerNodeId is string => typeof ownerNodeId === "string",
    );
  }
  return owners;
}

export async function readOwnedNodeClosure(
  store: ProjectionGenerationStore,
  generationId: string,
  view: ViewMode,
  rootNodeIds: ReadonlySet<string>,
): Promise<Record<string, string>> {
  const owners: Record<string, string> = {};
  const visited = new Set<string>();
  let frontier = [...rootNodeIds];
  const maximumDepth = 4_096;
  for (let depth = 0; frontier.length > 0; depth += 1) {
    if (depth >= maximumDepth) {
      throw new Error("Node ownership exceeds the state-dependent read bound");
    }
    const parentNodeIds = frontier.filter((nodeId) => !visited.has(nodeId));
    if (parentNodeIds.length === 0) {
      break;
    }
    parentNodeIds.forEach((nodeId) => visited.add(nodeId));
    const batch = await store.read(generationId, view, "nodeIdsByOwner", parentNodeIds);
    frontier = [];
    for (const entry of batch.entries) {
      if (!Array.isArray(entry.value)) {
        continue;
      }
      for (const ownedNodeId of entry.value) {
        if (typeof ownedNodeId === "string") {
          owners[ownedNodeId] = entry.identity;
          frontier.push(ownedNodeId);
        }
      }
    }
  }
  return owners;
}
