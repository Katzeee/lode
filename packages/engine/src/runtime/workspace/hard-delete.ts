import type {
  HardDeleteBlocker,
  HardDeletePreview,
  HardDeleteSelection,
} from "../../application/contract.js";
import {
  canonicalJson,
  compareFacts,
  stableStringCompare,
  type ContributionFact,
  type Fact,
  type FactSnapshot,
} from "../../domain/fact/index.js";
import { pendingProposalFacts } from "../../domain/review/evidence.js";
import { activeContributions } from "../../domain/reconcile/projection-active.js";
import {
  mutationReferencesNode,
  purgedNodeIds,
} from "../../domain/reconcile/maintenance-projection.js";
import { nodeDeletionFactIds } from "../../domain/reconcile/node-lifecycle.js";
import type { FactAuthority } from "../authority/fact-authority.js";

export function hardDeletePreview(
  workspaceId: string,
  nodeId: string,
  snapshot: FactSnapshot,
  facts: FactAuthority,
  generationId: string,
): HardDeletePreview {
  const active = activeContributions(snapshot, "origin").facts;
  const deletionFactIds = [...(nodeDeletionFactIds(active).get(nodeId) ?? [])].sort(
    stableStringCompare,
  );
  const retiredReplicaIds = retiredReplicas(snapshot.facts);
  const knownReplicaIds = [...new Set([facts.replicaId, ...Object.keys(snapshot.frontier)])]
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
  const outcomeUnknownInvocationIds = facts.uncertainInvocations();
  const allHistoryImpacts = facts.historyImpacts(nodeId);
  const historyImpactLimit = 50;
  const visibleHistoryImpacts = allHistoryImpacts.slice(0, historyImpactLimit);
  const selection: HardDeleteSelection = {
    workspaceId,
    frontier: snapshot.frontier,
    nodeId,
    deletionFactIds,
    acknowledgementFactIds,
    retiredReplicaIds,
  };
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
  if (outcomeUnknownInvocationIds.length > 0) {
    blockers.push("outcome-unknown");
  }
  return {
    generationId,
    selection,
    referenceOccurrenceIds: currentOccurrenceReferences(active, nodeId),
    schemaApplicationNodeIds: currentRelationOwners(
      active,
      nodeId,
      "schema-apply",
      "schema-remove",
    ),
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
    outcomeUnknownInvocationIds,
    historyImpact: {
      affectedInvocationIds: visibleHistoryImpacts.map((impact) => impact.invocationId),
      affectedChannelIds: [...new Set(visibleHistoryImpacts.map((impact) => impact.channelId))],
      totalAffectedInvocations: allHistoryImpacts.length,
      truncated: allHistoryImpacts.length > historyImpactLimit,
    },
    blockers,
    canExecute: blockers.length === 0,
  };
}

export function sameHardDeleteSelection(
  left: HardDeleteSelection,
  right: HardDeleteSelection,
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

function currentRelationOwners(
  active: readonly ContributionFact[],
  targetId: string,
  addKind: "schema-apply",
  removeKind: "schema-remove",
): string[] {
  const additions = active.filter(
    (fact) => fact.body.mutation.kind === addKind && fact.body.mutation.schemaId === targetId,
  );
  const removals = active.filter(
    (fact) => fact.body.mutation.kind === removeKind && fact.body.mutation.schemaId === targetId,
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
