import { graphActionBody, workspaceGenesisActions } from "../../../domain/fact/index.js";
import type { FactAuthorityPort } from "../authority/authority-contract.js";
import { workspaceGenesisFact } from "../workspace-genesis-validation.js";

type WorkspaceGenesisAuthority = Pick<FactAuthorityPort, "snapshot" | "commit" | "receipts" | "replicaId">;

export async function ensureWorkspaceGenesis(workspaceId: string, facts: WorkspaceGenesisAuthority): Promise<void> {
  const snapshot = facts.snapshot();
  if (snapshot.facts.length > 0) {
    workspaceGenesisFact(workspaceId, snapshot.facts);
    return;
  }
  if (facts.receipts().length > 0) {
    throw new Error("Workspace authority is missing its complete genesis Fact");
  }
  await facts.commit({
    invocationId: `workspace-genesis/${facts.replicaId}`,
    request: { kind: "workspace-genesis", workspaceId },
    writes: [graphActionBody("workspace-genesis", "direct", workspaceGenesisActions(workspaceId))],
    lineage: null,
    publishedFrontier: snapshot.frontier,
  });
}
