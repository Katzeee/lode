import { deriveActiveContributions, pendingProposalFacts } from "../activation/index.js";
import {
  canonicalJson,
  compareFacts,
  stableStringCompare,
  type ContributionFact,
  type Fact,
} from "../fact/index.js";
import { mutationReferencesNode, nodeDeletionFactIds, purgedNodeIds } from "./maintenance-state.js";
import type { HardDeleteAssessment, HardDeleteBlocker, HardDeleteEvidence } from "./types.js";

export function evaluateHardDelete(evidence: HardDeleteEvidence): HardDeleteAssessment {
  const { workspaceId, nodeId, snapshot, localReplicaId } = evidence;
  const active = deriveActiveContributions(snapshot.facts, "origin").facts;
  const deletionFactIds = [...(nodeDeletionFactIds(active).get(nodeId) ?? [])].sort(
    stableStringCompare,
  );
  const retiredReplicaIds = retiredReplicas(snapshot.facts);
  const knownReplicaIds = [...new Set([localReplicaId, ...Object.keys(snapshot.frontier)])]
    .filter((replicaId) => !retiredReplicaIds.includes(replicaId))
    .sort(stableStringCompare);
  const acknowledgements = currentAcknowledgements(snapshot.facts, nodeId, deletionFactIds);
  const acknowledgementFactIds = acknowledgements.map((fact) => fact.id);
  const acknowledgedReplicaIds = acknowledgements
    .map((fact) => fact.coordinate.dot.replicaId)
    .sort(stableStringCompare);
  const pendingProposalContributionIds = [...pendingProposalFacts(snapshot).values()]
    .filter((fact) => mutationReferencesNode(fact.body.mutation, nodeId))
    .map((fact) => fact.id)
    .sort(stableStringCompare);
  const blockers: HardDeleteBlocker[] = [];
  if (purgedNodeIds(snapshot.facts).has(nodeId)) {
    blockers.push("already-purged");
  }
  if (deletionFactIds.length === 0) {
    blockers.push("not-tombstoned");
  }
  if (pendingProposalContributionIds.length > 0) {
    blockers.push("pending-proposal");
  }
  if (knownReplicaIds.some((replicaId) => !acknowledgedReplicaIds.includes(replicaId))) {
    blockers.push("replica-unconfirmed");
  }
  if (evidence.outcomeUnknownInvocationIds.length > 0) {
    blockers.push("outcome-unknown");
  }
  return {
    selection: {
      workspaceId,
      frontier: snapshot.frontier,
      nodeId,
      deletionFactIds,
      acknowledgementFactIds,
      retiredReplicaIds,
    },
    referenceOccurrenceIds: currentOccurrenceReferences(active, nodeId),
    schemaApplicationNodeIds: currentSchemaApplicationOwners(active, nodeId),
    materializedFieldNodeIds: active
      .flatMap((fact) =>
        fact.body.mutation.kind === "field-materialize" &&
        fact.body.mutation.fieldDefinitionId === nodeId
          ? [fact.body.mutation.fieldNodeId]
          : [],
      )
      .filter(unique)
      .sort(stableStringCompare),
    pendingProposalContributionIds,
    knownReplicaIds,
    acknowledgedReplicaIds,
    outcomeUnknownInvocationIds: [...evidence.outcomeUnknownInvocationIds],
    blockers,
    canExecute: blockers.length === 0,
  };
}

export function sameHardDeleteSelection(
  left: HardDeleteAssessment["selection"],
  right: HardDeleteAssessment["selection"],
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function retiredReplicas(facts: readonly Fact[]): string[] {
  return facts
    .flatMap((fact) =>
      fact.body.kind === "maintenance" && fact.body.action.kind === "replica-retire"
        ? [fact.body.action.replicaId]
        : [],
    )
    .filter(unique)
    .sort(stableStringCompare);
}

function currentAcknowledgements(
  facts: readonly Fact[],
  nodeId: string,
  deletionFactIds: readonly string[],
): Fact[] {
  const matching = facts.filter(
    (fact) =>
      fact.body.kind === "maintenance" &&
      fact.body.action.kind === "deletion-acknowledge" &&
      fact.body.action.nodeId === nodeId &&
      canonicalJson([...fact.body.action.deletionFactIds].sort()) ===
        canonicalJson(deletionFactIds),
  );
  const byReplica = new Map<string, Fact>();
  for (const fact of matching.sort(compareFacts)) {
    byReplica.set(fact.coordinate.dot.replicaId, fact);
  }
  return [...byReplica.values()].sort((left, right) =>
    stableStringCompare(left.coordinate.dot.replicaId, right.coordinate.dot.replicaId),
  );
}

function currentOccurrenceReferences(
  active: readonly ContributionFact[],
  nodeId: string,
): string[] {
  const deleted = new Set(
    active.flatMap((fact) =>
      fact.body.mutation.kind === "occurrence-delete" ? [fact.body.mutation.occurrenceId] : [],
    ),
  );
  return active
    .flatMap((fact) =>
      fact.body.mutation.kind === "occurrence-create" &&
      fact.body.mutation.nodeId === nodeId &&
      !deleted.has(fact.body.mutation.occurrenceId)
        ? [fact.body.mutation.occurrenceId]
        : [],
    )
    .filter(unique)
    .sort(stableStringCompare);
}

function currentSchemaApplicationOwners(
  active: readonly ContributionFact[],
  schemaId: string,
): string[] {
  const additions = active.filter(
    (fact) =>
      fact.body.mutation.kind === "schema-apply" && fact.body.mutation.schemaId === schemaId,
  );
  const removals = active.filter(
    (fact) =>
      fact.body.mutation.kind === "schema-remove" && fact.body.mutation.schemaId === schemaId,
  );
  return additions
    .flatMap((addition) => {
      if (addition.body.mutation.kind !== "schema-apply") {
        return [];
      }
      const ownerNodeId = addition.body.mutation.nodeId;
      const removed = removals.some(
        (removal) =>
          removal.body.mutation.kind === "schema-remove" &&
          removal.body.mutation.nodeId === ownerNodeId &&
          observes(removal, addition),
      );
      return removed ? [] : [ownerNodeId];
    })
    .filter(unique)
    .sort(stableStringCompare);
}

function observes(observer: Fact, observed: Fact): boolean {
  const { replicaId, sequence } = observed.coordinate.dot;
  return (observer.coordinate.observed[replicaId] ?? 0) >= sequence;
}

function unique(value: string, index: number, values: readonly string[]): boolean {
  return value.length > 0 && values.indexOf(value) === index;
}
