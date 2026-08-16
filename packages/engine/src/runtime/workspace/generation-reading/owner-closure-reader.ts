import type { ProjectionPerspective } from "../../../domain/fact/index.js";
import type { ProjectionSnapshotReader } from "../../materialization/index.js";

export async function readOwnerClosure(
  store: ProjectionSnapshotReader,
  generationId: string,
  perspective: ProjectionPerspective,
  initialNodeIds: ReadonlySet<string>,
): Promise<Record<string, string | null>> {
  const owners: Record<string, string | null> = {};
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
    const batch = await store.read(generationId, perspective, "nodeOwners", wanted);
    const current = Object.fromEntries(batch.entries.map((entry) => [entry.identity, entry.value]));
    Object.assign(owners, current);
    frontier = Object.values(current).filter((ownerNodeId) => ownerNodeId !== null);
  }
  return owners;
}

export async function readOwnedNodeClosure(
  store: ProjectionSnapshotReader,
  generationId: string,
  perspective: ProjectionPerspective,
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
    const batch = await store.read(generationId, perspective, "nodeIdsByOwner", parentNodeIds);
    frontier = [];
    for (const entry of batch.entries) {
      for (const ownedNodeId of entry.value) {
        owners[ownedNodeId] = entry.identity;
        frontier.push(ownedNodeId);
      }
    }
  }
  return owners;
}
