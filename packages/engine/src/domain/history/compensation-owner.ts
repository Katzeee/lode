import { compareFacts, contributionFactsOfKind, type ContributionFact } from "../fact/index.js";
import type { ScopedProjection } from "../reconcile/index.js";
import { noCompensation, type CompensationStep } from "./compensation-types.js";

export function compensateNodeOwner(
  target: ContributionFact,
  activeFacts: readonly ContributionFact[],
  projection: ScopedProjection,
): CompensationStep {
  const mutation = target.body.mutation;
  if (mutation.kind !== "node-owner-set" || mutation.previousOwnerNodeId === undefined) {
    return noCompensation();
  }
  if (
    mutation.previousOwnerNodeId === null &&
    activeFacts.some(
      (fact) =>
        fact.transaction.transactionId === target.transaction.transactionId &&
        fact.body.mutation.kind === "node-create" &&
        fact.body.mutation.nodeId === mutation.nodeId,
    )
  ) {
    return noCompensation();
  }
  const winner = [...contributionFactsOfKind(activeFacts, "node-owner-set")]
    .filter((fact) => fact.body.mutation.nodeId === mutation.nodeId)
    .sort(compareFacts)
    .at(-1);
  if (winner?.id !== target.id || projection.nodeOwners[mutation.nodeId] !== mutation.ownerNodeId) {
    return noCompensation();
  }
  if (mutation.previousOwnerNodeId !== null && !projection.nodes[mutation.previousOwnerNodeId]) {
    return { kind: "stale", reason: "Previous Owner Node is no longer valid" };
  }
  return {
    kind: "ready",
    mutations: [
      {
        kind: "node-owner-set",
        nodeId: mutation.nodeId,
        ownerNodeId: mutation.previousOwnerNodeId,
        previousOwnerNodeId: mutation.ownerNodeId,
      },
    ],
  };
}
