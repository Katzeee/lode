import { canonicalJson } from "./canonical.js";
import { factObserves } from "./frontier.js";
import type { Fact } from "./types.js";

export function validateMaintenanceFact(fact: Fact, admitted: readonly Fact[]): void {
  validateRetiredReplica(fact, admitted);
  if (fact.body.kind !== "maintenance") {
    return;
  }
  const action = fact.body.action;
  if (action.kind === "replica-retire") {
    validateReplicaRetirement(fact, admitted, action.replicaId);
    return;
  }
  const deletionFactIds = currentDeletionFactIds(fact, admitted, action.nodeId);
  if (canonicalJson([...action.deletionFactIds].sort()) !== canonicalJson(deletionFactIds)) {
    throw new Error(`Maintenance deletion evidence is stale: ${fact.id}`);
  }
  if (action.kind === "deletion-acknowledge") {
    return;
  }
  validatePurge(fact, admitted, action, deletionFactIds);
}

function validateReplicaRetirement(fact: Fact, admitted: readonly Fact[], retiredReplicaId: string): void {
  if (retiredReplicaId === fact.coordinate.dot.replicaId) {
    throw new Error(`Replica cannot retire itself: ${fact.id}`);
  }
  if (
    admitted.some(
      (candidate) =>
        candidate.coordinate.dot.replicaId === retiredReplicaId &&
        candidate.coordinate.dot.sequence > (fact.coordinate.observed[retiredReplicaId] ?? 0),
    )
  ) {
    throw new Error(`Replica retirement does not cover its current frontier: ${fact.id}`);
  }
}

function validatePurge(
  fact: Fact,
  admitted: readonly Fact[],
  action: Extract<Fact["body"], { kind: "maintenance" }>["action"] & {
    kind: "node-purge";
  },
  deletionFactIds: readonly string[],
): void {
  const acknowledgements = action.acknowledgementFactIds.map((factId) => {
    const acknowledgement = admitted.find((candidate) => candidate.id === factId);
    if (
      acknowledgement?.body.kind !== "maintenance" ||
      acknowledgement.body.action.kind !== "deletion-acknowledge" ||
      acknowledgement.body.action.nodeId !== action.nodeId ||
      canonicalJson([...acknowledgement.body.action.deletionFactIds].sort()) !== canonicalJson(deletionFactIds) ||
      !factObserves(fact, acknowledgement)
    ) {
      throw new Error(`Purge acknowledgement evidence is invalid: ${fact.id}`);
    }
    return acknowledgement;
  });
  const retired = new Set(action.retiredReplicaIds);
  for (const replicaId of retired) {
    const retirement = admitted.find(
      (candidate) =>
        candidate.body.kind === "maintenance" &&
        candidate.body.action.kind === "replica-retire" &&
        candidate.body.action.replicaId === replicaId &&
        factObserves(fact, candidate),
    );
    if (!retirement) {
      throw new Error(`Purge retirement evidence is invalid: ${fact.id}`);
    }
  }
  const knownReplicaIds = new Set([
    fact.coordinate.dot.replicaId,
    ...admitted
      .filter((candidate) => factObserves(fact, candidate))
      .map((candidate) => candidate.coordinate.dot.replicaId),
  ]);
  const required = [...knownReplicaIds].filter((replicaId) => !retired.has(replicaId)).sort();
  const confirmed = [...new Set(acknowledgements.map((candidate) => candidate.coordinate.dot.replicaId))].sort();
  if (canonicalJson(required) !== canonicalJson(confirmed)) {
    throw new Error(`Purge lacks acknowledgement from every known Replica: ${fact.id}`);
  }
}

function validateRetiredReplica(fact: Fact, admitted: readonly Fact[]): void {
  const retirement = admitted.find(
    (candidate) =>
      candidate.body.kind === "maintenance" &&
      candidate.body.action.kind === "replica-retire" &&
      candidate.body.action.replicaId === fact.coordinate.dot.replicaId,
  );
  if (
    retirement?.body.kind === "maintenance" &&
    fact.coordinate.dot.sequence > (retirement.coordinate.observed[fact.coordinate.dot.replicaId] ?? 0)
  ) {
    throw new Error(`Retired Replica cannot append new Facts: ${fact.id}`);
  }
}

function currentDeletionFactIds(fact: Fact, admitted: readonly Fact[], nodeId: string): string[] {
  const observed = admitted.filter((candidate) => factObserves(fact, candidate));
  const restored = new Set(
    observed.flatMap((candidate) =>
      candidate.body.kind === "contribution" &&
      candidate.body.mutation.kind === "node-restore" &&
      candidate.body.mutation.nodeId === nodeId
        ? [candidate.body.mutation.deletionFactId]
        : [],
    ),
  );
  return observed
    .filter(
      (candidate) =>
        candidate.body.kind === "contribution" &&
        candidate.body.mutation.kind === "node-delete" &&
        candidate.body.mutation.nodeId === nodeId &&
        !restored.has(candidate.id),
    )
    .map((candidate) => candidate.id)
    .sort();
}
