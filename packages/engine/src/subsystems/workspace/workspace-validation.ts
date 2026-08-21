import {
  SYSTEM_DEFINITION_CATALOG_NODE_ID,
  canonicalJson,
  workspaceGenesisMutations,
  workspaceSchemaNodeId,
  workspaceTrashNodeId,
  type Fact,
  type FactSnapshot,
} from "../../domain/fact/index.js";
import { CURRENT_PROJECTION_VERSIONS, rebuildGeneration, textAtoms } from "../../domain/reconcile/index.js";

export function validateWorkspaceSnapshot(workspaceId: string, snapshot: FactSnapshot): Readonly<{ label: string }> {
  const establish = snapshot.facts.filter(
    (fact) => fact.body.kind === "governance" && fact.body.action.kind === "workspace-establish",
  );
  if (establish.length !== 1) {
    throw new Error("Workspace journal must contain exactly one Workspace establishment");
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

  const expectedGenesis = canonicalJson(workspaceGenesisMutations(workspaceId));
  const genesisTransactions = [...transactions(snapshot.facts).values()].filter((facts) => {
    const ordered = [...facts].sort((left, right) => left.transaction.index - right.transaction.index);
    return (
      ordered.length === facts[0]?.transaction.size &&
      ordered.every((fact) => fact.body.kind === "contribution") &&
      canonicalJson(ordered.map((fact) => (fact.body.kind === "contribution" ? fact.body.mutation : null))) ===
        expectedGenesis
    );
  });
  if (genesisTransactions.length !== 1) {
    throw new Error("Workspace journal must contain exactly one complete Workspace genesis transaction");
  }
  if (genesisTransactions[0]?.some((fact) => fact.body.actorId !== initialOwnerActorId)) {
    throw new Error("Workspace genesis must be attributed to its initial owner");
  }

  const projection = rebuildGeneration(workspaceId, snapshot, CURRENT_PROJECTION_VERSIONS).origin;
  const root = projection.nodes[workspaceId];
  const system = projection.workspaceSystemNodes;
  if (
    root === undefined ||
    system.schema !== workspaceSchemaNodeId(workspaceId) ||
    system.trash !== workspaceTrashNodeId(workspaceId) ||
    system.systemDefinitionCatalog !== SYSTEM_DEFINITION_CATALOG_NODE_ID
  ) {
    throw new Error("Workspace journal does not project a complete Workspace root and system structure");
  }
  const label = textAtoms(root)
    .map((atom) => atom.value)
    .join("");
  if (label.trim().length === 0) {
    throw new Error("Workspace has no non-empty journal label");
  }
  return { label };
}

function transactions(facts: readonly Fact[]): ReadonlyMap<string, readonly Fact[]> {
  const grouped = new Map<string, Fact[]>();
  for (const fact of facts) {
    const transaction = grouped.get(fact.transaction.transactionId) ?? [];
    transaction.push(fact);
    grouped.set(fact.transaction.transactionId, transaction);
  }
  return grouped;
}
