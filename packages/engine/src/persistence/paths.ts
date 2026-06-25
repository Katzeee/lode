import { join } from "node:path";

export function registryDbPath(dataRoot: string): string {
  return join(dataRoot, "registry.sqlite");
}

export function workspaceRelativePath(workspaceId: string): string {
  return join("workspaces", workspaceId);
}

export function workspaceDbPath(dataRoot: string, relativePath: string): string {
  return join(dataRoot, relativePath, "workspace.sqlite");
}
