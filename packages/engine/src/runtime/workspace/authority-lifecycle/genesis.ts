import { WORKSPACE_NODE_TYPE, type Fact } from "../../../domain/fact/index.js";
import type { FactAuthority } from "../../authority/fact-authority.js";

type WorkspaceGenesisAuthority = Pick<FactAuthority, "admission" | "commit" | "receipts" | "replicaId">;

export async function ensureWorkspaceGenesis(workspaceId: string, facts: WorkspaceGenesisAuthority): Promise<void> {
  const admission = facts.admission();
  if (
    admission.kind === "fault" ||
    (admission.snapshot.facts.length === 0 && facts.receipts().length > 0) ||
    hasWorkspaceGenesis(admission.snapshot.facts, workspaceId)
  ) {
    return;
  }
  await facts.commit({
    invocationId: `workspace-genesis/${facts.replicaId}`,
    request: { kind: "workspace-genesis", workspaceId },
    writes: [
      {
        kind: "transaction",
        bodies: [
          {
            kind: "contribution",
            actorId: "workspace-genesis",
            intent: "direct",
            mutation: { kind: "node-create", nodeId: workspaceId },
          },
          {
            kind: "contribution",
            actorId: "workspace-genesis",
            intent: "direct",
            mutation: {
              kind: "node-type-declare",
              nodeId: workspaceId,
              nodeType: WORKSPACE_NODE_TYPE,
            },
          },
        ],
      },
    ],
    lineage: null,
    publishedFrontier: admission.snapshot.frontier,
  });
}

function hasWorkspaceGenesis(facts: readonly Fact[], workspaceId: string): boolean {
  let hasNode = false;
  let hasNodeType = false;
  for (const fact of facts) {
    if (fact.body.kind !== "contribution") {
      continue;
    }
    const mutation = fact.body.mutation;
    hasNode ||= mutation.kind === "node-create" && mutation.nodeId === workspaceId;
    hasNodeType ||=
      mutation.kind === "node-type-declare" &&
      mutation.nodeId === workspaceId &&
      mutation.nodeType === WORKSPACE_NODE_TYPE;
  }
  return hasNode && hasNodeType;
}
