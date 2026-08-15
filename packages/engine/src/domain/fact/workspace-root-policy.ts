import type { Fact, WorkspaceId } from "./types.js";

export function validateWorkspaceRootPolicy(workspaceId: WorkspaceId, fact: Fact): void {
  if (fact.body.kind === "contribution") {
    const mutation = fact.body.mutation;
    if (
      (mutation.kind === "node-delete" || mutation.kind === "node-restore" || mutation.kind === "node-owner-set") &&
      mutation.nodeId === workspaceId
    ) {
      throw new Error(`Workspace root Node cannot change ownership or deletion state: ${fact.id}`);
    }
    return;
  }
  if (
    fact.body.kind === "maintenance" &&
    fact.body.action.kind !== "replica-retire" &&
    fact.body.action.nodeId === workspaceId
  ) {
    throw new Error(`Workspace Node cannot be deleted or purged: ${fact.id}`);
  }
}
