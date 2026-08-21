import {
  SYSTEM_DEFINITION_CATALOG_NODE_ID,
  WORKSPACE_INTRINSIC_NODE_TYPE,
  workspaceGenesisMutations,
  workspaceTrashOccurrenceId,
  type Fact,
} from "../../../domain/fact/index.js";
import type { FactAuthorityPort } from "../authority/authority-contract.js";

type WorkspaceGenesisAuthority = Pick<FactAuthorityPort, "admission" | "commit" | "receipts" | "replicaId">;

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
        bodies: workspaceGenesisBodies(workspaceId),
      },
    ],
    lineage: null,
    publishedFrontier: admission.snapshot.frontier,
  });
}

function workspaceGenesisBodies(workspaceId: string): readonly [Fact["body"], ...Fact["body"][]] {
  const [first, ...rest] = workspaceGenesisMutations(workspaceId);
  const body = (mutation: typeof first): Fact["body"] => ({
    kind: "contribution",
    actorId: "workspace-genesis",
    intent: "direct",
    mutation,
  });
  return [body(first), ...rest.map(body)];
}

function hasWorkspaceGenesis(facts: readonly Fact[], workspaceId: string): boolean {
  let hasNode = false;
  let hasIntrinsicNodeType = false;
  let trashRoleNodeId: string | null = null;
  const trashOccurrenceId = workspaceTrashOccurrenceId(workspaceId);
  for (const fact of facts) {
    if (fact.body.kind !== "contribution") {
      continue;
    }
    const mutation = fact.body.mutation;
    hasNode ||= mutation.kind === "node-create" && mutation.nodeId === workspaceId;
    hasIntrinsicNodeType ||=
      mutation.kind === "intrinsic-node-type-declare" &&
      mutation.nodeId === workspaceId &&
      mutation.intrinsicNodeType === WORKSPACE_INTRINSIC_NODE_TYPE;
    if (
      mutation.kind === "occurrence-create" &&
      mutation.occurrenceId === trashOccurrenceId &&
      mutation.parentNodeId === workspaceId
    ) {
      trashRoleNodeId = mutation.nodeId;
    }
  }
  const hasTrashNode =
    trashRoleNodeId !== null &&
    facts.some(
      (fact) =>
        fact.body.kind === "contribution" &&
        fact.body.mutation.kind === "node-create" &&
        fact.body.mutation.nodeId === trashRoleNodeId,
    );
  const hasSystemDefinitionCatalog = facts.some(
    (fact) =>
      fact.body.kind === "contribution" &&
      fact.body.mutation.kind === "node-owner-set" &&
      fact.body.mutation.nodeId === SYSTEM_DEFINITION_CATALOG_NODE_ID &&
      fact.body.mutation.ownerNodeId === workspaceId,
  );
  return hasNode && hasIntrinsicNodeType && hasTrashNode && hasSystemDefinitionCatalog;
}
