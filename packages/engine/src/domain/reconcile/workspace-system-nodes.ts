import { workspaceTrashOccurrenceId } from "../fact/index.js";

export const WORKSPACE_SYSTEM_NODE_ROLES = ["trash"] as const;

export type WorkspaceSystemNodeRole = (typeof WORKSPACE_SYSTEM_NODE_ROLES)[number];
export type WorkspaceSystemNodes = Readonly<Partial<Record<WorkspaceSystemNodeRole, string>>>;

type RoleOccurrence = Readonly<{
  occurrenceId: string;
  nodeId: string;
  parentNodeId: string;
}>;

export function projectWorkspaceSystemNodes(
  workspaceNodeId: string,
  occurrences: ReadonlyMap<string, RoleOccurrence>,
): WorkspaceSystemNodes {
  const trash = occurrences.get(workspaceTrashOccurrenceId(workspaceNodeId));
  return trash?.parentNodeId === workspaceNodeId ? { trash: trash.nodeId } : {};
}
