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

/** The per-dataRoot actor catalog (actorId → displayName / pubkey). Identity lives per-dataRoot. */
export function actorDbPath(dataRoot: string): string {
  return join(dataRoot, "actors.sqlite");
}

/** An actor's private-key keystore file (0600). Separate from the catalog for a clean secret boundary. */
export function actorKeystorePath(dataRoot: string, actorId: string): string {
  return join(dataRoot, "actors", actorId, "keystore");
}
