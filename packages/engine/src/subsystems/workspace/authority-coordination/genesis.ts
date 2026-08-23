import { canonicalJson, workspaceGenesisActions, type Fact } from "../../../domain/fact/index.js";
import type { FactAuthorityPort } from "../authority/authority-contract.js";

type WorkspaceGenesisAuthority = Pick<FactAuthorityPort, "snapshot" | "commit" | "receipts" | "replicaId">;

export async function ensureWorkspaceGenesis(workspaceId: string, facts: WorkspaceGenesisAuthority): Promise<void> {
  const snapshot = facts.snapshot();
  if (hasWorkspaceGenesis(snapshot.facts, workspaceId)) {
    return;
  }
  if (snapshot.facts.length > 0 || facts.receipts().length > 0) {
    throw new Error("Workspace authority is missing its complete genesis Fact");
  }
  await facts.commit({
    invocationId: `workspace-genesis/${facts.replicaId}`,
    request: { kind: "workspace-genesis", workspaceId },
    writes: [
      {
        kind: "edit",
        actorId: "workspace-genesis",
        intent: "direct",
        actions: workspaceGenesisActions(workspaceId),
      },
    ],
    lineage: null,
    inverse: [],
    publishedFrontier: snapshot.frontier,
  });
}

function hasWorkspaceGenesis(facts: readonly Fact[], workspaceId: string): boolean {
  const expected = canonicalJson(workspaceGenesisActions(workspaceId));
  return facts.some((fact) => fact.body.kind === "edit" && canonicalJson(fact.body.actions) === expected);
}
