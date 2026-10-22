import type { WorkspaceSnapshot } from "./workspace-model.js";

export function workspaceOwnerChain(graph: WorkspaceSnapshot, nodeId: string): readonly string[] {
  const chain: string[] = [];
  const visited = new Set<string>();
  let current: string | null | undefined = nodeId;
  while (current && !visited.has(current)) {
    visited.add(current);
    chain.push(current);
    current = graph.nodeOwners[current];
  }
  return chain;
}

export function workspaceNodeInTrash(graph: WorkspaceSnapshot, nodeId: string): boolean {
  const trash = graph.workspaceSystemNodes.trash;
  return trash !== undefined && workspaceOwnerChain(graph, nodeId).includes(trash);
}
