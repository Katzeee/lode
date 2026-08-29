import {
  frontierEquals,
  SYSTEM_DEFINITION_CATALOG_NODE_ID,
  workspaceSchemaNodeId,
  workspaceTrashNodeId,
  type FactSnapshot,
} from "../../domain/fact/index.js";
import { textAtoms, type ProjectionGeneration } from "../../domain/reconcile/index.js";
import { workspaceGenesisFact } from "./workspace-genesis-validation.js";

export function validateWorkspaceSnapshot(
  workspaceId: string,
  snapshot: FactSnapshot,
  generation: ProjectionGeneration,
): Readonly<{ label: string }> {
  if (
    generation.identity.workspaceNodeId !== workspaceId ||
    !frontierEquals(generation.identity.frontier, snapshot.frontier)
  ) {
    throw new Error("Workspace Projection does not match the authority snapshot");
  }
  const establish = snapshot.facts.filter(
    (fact) => fact.body.kind === "governance" && fact.body.action.kind === "workspace-establish",
  );
  if (establish.length !== 1) {
    throw new Error("Workspace authority must contain exactly one Workspace establishment");
  }
  const establishment = establish[0];
  if (
    establishment?.body.kind !== "governance" ||
    establishment.body.action.kind !== "workspace-establish" ||
    establishment.body.actorId !== establishment.body.action.ownerActorId
  ) {
    throw new Error("Workspace establishment must be signed by its initial owner");
  }
  const initialOwnerActorId = establishment.body.action.ownerActorId;

  const genesis = workspaceGenesisFact(workspaceId, snapshot.facts);
  if (genesis.body.kind !== "action" || genesis.body.actorId !== initialOwnerActorId) {
    throw new Error("Workspace genesis must be attributed to its initial owner");
  }

  const projection = generation.origin;
  const root = projection.nodes[workspaceId];
  const system = projection.workspaceSystemNodes;
  if (
    root === undefined ||
    system.schema !== workspaceSchemaNodeId(workspaceId) ||
    system.trash !== workspaceTrashNodeId(workspaceId) ||
    system.systemDefinitionCatalog !== SYSTEM_DEFINITION_CATALOG_NODE_ID
  ) {
    throw new Error("Workspace authority does not project a complete Workspace root and system structure");
  }
  const label = textAtoms(root)
    .map((atom) => atom.value)
    .join("");
  if (label.trim().length === 0) {
    throw new Error("Workspace has no non-empty authority label");
  }
  return { label };
}
