import type { FactAuthority } from "../authority/fact-authority.js";

export async function ensureWorkspaceNode(
  workspaceId: string,
  facts: FactAuthority,
): Promise<void> {
  const admission = facts.admission();
  if (
    admission.kind === "fault" ||
    (admission.snapshot.facts.length === 0 && facts.receipts().length > 0) ||
    admission.snapshot.facts.some(
      (fact) =>
        fact.body.kind === "contribution" &&
        fact.body.mutation.kind === "node-create" &&
        fact.body.mutation.nodeId === workspaceId,
    )
  ) {
    return;
  }
  await facts.commit({
    invocationId: `workspace-genesis/${facts.replicaId}`,
    request: { kind: "workspace-genesis", workspaceId },
    writes: [
      {
        kind: "contribution",
        actorId: "workspace-genesis",
        intent: "direct",
        mutation: { kind: "node-create", nodeId: workspaceId },
      },
    ],
    lineage: null,
    publishedFrontier: admission.snapshot.frontier,
  });
}
