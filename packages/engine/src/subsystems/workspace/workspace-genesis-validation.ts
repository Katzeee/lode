import {
  SYSTEM_DEFINITION_CATALOG_NODE_ID,
  workspaceSchemaNodeId,
  workspaceTrashNodeId,
  type Fact,
} from "../../domain/fact/index.js";
import { CURRENT_PROJECTION_VERSIONS, rebuildGeneration } from "../../domain/reconcile/index.js";

export function workspaceGenesisFact(workspaceId: string, facts: readonly Fact[]): Fact {
  const matches = facts.flatMap((fact) => {
    if (fact.body.kind !== "action" || fact.body.intent !== "direct") {
      return [];
    }
    const bootstrapCount = fact.body.actions.filter(
      (action) => action.kind === "workspace-bootstrap" && action.workspaceNodeId === workspaceId,
    ).length;
    return bootstrapCount === 0 ? [] : [{ fact, bootstrapCount }];
  });
  if (matches.length !== 1 || matches[0]?.bootstrapCount !== 1) {
    throw new Error("Workspace authority must contain exactly one Workspace bootstrap action");
  }

  const genesis = matches[0].fact;
  const projection = rebuildGeneration(
    workspaceId,
    {
      facts: [genesis],
      frontier: { [genesis.coordinate.dot.replicaId]: genesis.coordinate.dot.sequence },
    },
    CURRENT_PROJECTION_VERSIONS,
  ).origin;
  if (
    projection.nodes[workspaceId] === undefined ||
    projection.workspaceSystemNodes.schema !== workspaceSchemaNodeId(workspaceId) ||
    projection.workspaceSystemNodes.trash !== workspaceTrashNodeId(workspaceId) ||
    projection.workspaceSystemNodes.systemDefinitionCatalog !== SYSTEM_DEFINITION_CATALOG_NODE_ID
  ) {
    throw new Error("Workspace bootstrap Fact does not establish the complete Workspace system structure");
  }
  return genesis;
}
