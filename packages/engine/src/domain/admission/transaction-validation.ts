import type { FactSnapshot, FactTransaction } from "../fact/index.js";
import { CURRENT_PROJECTION_VERSIONS, rebuildGeneration } from "../reconcile/index.js";

export function validateDomainTransaction(
  transaction: FactTransaction,
  _before: FactSnapshot,
  after: FactSnapshot,
): void {
  validateTransactionIntent(transaction);
  validateNodeCreations(transaction);
  validateOwnershipCompleteness(after);
}

function validateTransactionIntent(transaction: FactTransaction): void {
  if (transaction.facts.length === 1) {
    return;
  }
  const first = transaction.facts[0]?.body;
  if (first?.kind !== "contribution") {
    throw new Error("A multi-Fact domain transaction must contain only Contributions");
  }
  for (const fact of transaction.facts) {
    if (
      fact.body.kind !== "contribution" ||
      fact.body.actorId !== first.actorId ||
      fact.body.intent !== first.intent
    ) {
      throw new Error("A multi-Fact domain transaction requires one actor and one intent");
    }
  }
}

function validateNodeCreations(transaction: FactTransaction): void {
  const workspaceId = transaction.facts[0]?.workspaceId;
  const creations = transaction.facts.flatMap((fact) =>
    fact.body.kind === "contribution" && fact.body.mutation.kind === "node-create"
      ? [fact.body.mutation.nodeId]
      : [],
  );
  for (const nodeId of creations) {
    if (nodeId === workspaceId) {
      continue;
    }
    const placements = transaction.facts.filter(
      (fact) =>
        fact.body.kind === "contribution" &&
        fact.body.mutation.kind === "occurrence-create" &&
        fact.body.mutation.nodeId === nodeId,
    );
    if (placements.length !== 1) {
      throw new Error("Node creation transaction requires exactly one Original Occurrence");
    }
  }
}

function validateOwnershipCompleteness(snapshot: FactSnapshot): void {
  const generation = rebuildGeneration(
    snapshot.facts[0]?.workspaceId ?? "",
    snapshot,
    CURRENT_PROJECTION_VERSIONS,
  ).generation;
  for (const projection of [generation.origin, generation.review]) {
    const unownedNodeId = Object.keys(projection.nodes).find(
      (nodeId) => !Object.hasOwn(projection.nodeOwners, nodeId),
    );
    if (unownedNodeId) {
      throw new Error(`Active Node has no Original Occurrence: ${unownedNodeId}`);
    }
  }
}
