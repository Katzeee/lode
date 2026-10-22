import { SYSTEM_DEFINITION_CATALOG_NODE_ID, workspaceSchemaNodeId, workspaceTrashOccurrenceId } from "../fact/index.js";

type WorkspaceSystemNodeRole = "trash" | "schema" | "systemDefinitionCatalog";
export type WorkspaceSystemNodes = Readonly<Partial<Record<WorkspaceSystemNodeRole, string>>>;

type RoleOccurrence = Readonly<{
  occurrenceId: string;
  nodeId: string;
  parentNodeId: string;
}>;

export function projectWorkspaceSystemNodes(
  workspaceNodeId: string,
  occurrences: ReadonlyMap<string, RoleOccurrence>,
  nodeOwners: Readonly<Record<string, string | null>>,
): WorkspaceSystemNodes {
  const trash = occurrences.get(workspaceTrashOccurrenceId(workspaceNodeId));
  return {
    ...(trash?.parentNodeId === workspaceNodeId ? { trash: trash.nodeId } : {}),
    ...(nodeOwners[workspaceSchemaNodeId(workspaceNodeId)] === workspaceNodeId
      ? { schema: workspaceSchemaNodeId(workspaceNodeId) }
      : {}),
    ...(nodeOwners[SYSTEM_DEFINITION_CATALOG_NODE_ID] === workspaceNodeId
      ? { systemDefinitionCatalog: SYSTEM_DEFINITION_CATALOG_NODE_ID }
      : {}),
  };
}
