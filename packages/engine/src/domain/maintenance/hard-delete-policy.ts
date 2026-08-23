import { deriveActivation } from "../activation/index.js";
import {
  canonicalJson,
  compareCausalOrder,
  factActionsOfKind,
  factActionsFromFacts,
  factObserves,
  stableStringCompare,
  type FactAction,
  type FactActionId,
  type Fact,
} from "../fact/index.js";
import { actionReferencesNode, nodeDeletionActionIds, purgedNodeIds } from "./maintenance-state.js";
import type { HardDeleteAssessment, HardDeleteBlocker, HardDeleteEvidence } from "./types.js";

export function evaluateHardDelete(evidence: HardDeleteEvidence): HardDeleteAssessment {
  const { workspaceId, nodeId, snapshot, localReplicaId } = evidence;
  const allActions = factActionsFromFacts(snapshot.facts);
  const originActive = deriveActivation(snapshot.facts, "origin", allActions).activeActionIds;
  const reviewActive = deriveActivation(snapshot.facts, "review", allActions).activeActionIds;
  const active = allActions.filter((action) => originActive.has(action.id));
  const deletionActionIds = [...(nodeDeletionActionIds(active).get(nodeId) ?? [])].sort(stableStringCompare);
  const retiredReplicaIds = retiredReplicas(snapshot.facts);
  const knownReplicaIds = [...new Set([localReplicaId, ...Object.keys(snapshot.frontier)])]
    .filter((replicaId) => !retiredReplicaIds.includes(replicaId))
    .sort(stableStringCompare);
  const acknowledgements = currentAcknowledgements(snapshot.facts, nodeId, deletionActionIds);
  const acknowledgementFactIds = acknowledgements.map((fact) => fact.id);
  const acknowledgedReplicaIds = acknowledgements
    .map((fact) => fact.coordinate.dot.replicaId)
    .sort(stableStringCompare);
  const pendingProposalActionIds = allActions
    .filter(
      (action) =>
        action.intent === "proposal" &&
        reviewActive.has(action.id) &&
        !originActive.has(action.id) &&
        actionReferencesNode(action.action, nodeId),
    )
    .map((action) => action.id)
    .sort(stableStringCompare);
  const ownedDescendantNodeIds = [...evidence.ownedDescendantNodeIds].sort(stableStringCompare);
  const blockers: HardDeleteBlocker[] = [];
  if (purgedNodeIds(snapshot.facts).has(nodeId)) {
    blockers.push("already-purged");
  }
  if (deletionActionIds.length === 0) {
    blockers.push("not-in-trash");
  }
  if (ownedDescendantNodeIds.length > 0) {
    blockers.push("owned-descendants");
  }
  if (pendingProposalActionIds.length > 0) {
    blockers.push("pending-proposal");
  }
  if (knownReplicaIds.some((replicaId) => !acknowledgedReplicaIds.includes(replicaId))) {
    blockers.push("replica-unconfirmed");
  }
  return {
    selection: {
      workspaceId,
      frontier: snapshot.frontier,
      nodeId,
      deletionActionIds,
      acknowledgementFactIds,
      retiredReplicaIds,
    },
    referenceOccurrenceIds: currentOccurrenceReferences(active, nodeId),
    supertagApplicationNodeIds: currentSupertagApplicationOwners(active, nodeId),
    materializedFieldNodeIds: active
      .flatMap((fact) =>
        fact.action.kind === "field-materialize" && fact.action.fieldDefinitionId === nodeId
          ? [fact.action.fieldNodeId]
          : [],
      )
      .filter(unique)
      .sort(stableStringCompare),
    ownedDescendantNodeIds,
    pendingProposalActionIds,
    knownReplicaIds,
    acknowledgedReplicaIds,
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
  deletionActionIds: readonly FactActionId[],
): Fact[] {
  const matching = facts.filter(
    (fact) =>
      fact.body.kind === "maintenance" &&
      fact.body.action.kind === "deletion-acknowledge" &&
      fact.body.action.nodeId === nodeId &&
      canonicalJson(observedDeletionActionIds(facts, fact, nodeId)) === canonicalJson(deletionActionIds),
  );
  const byReplica = new Map<string, Fact>();
  for (const fact of matching.sort(compareCausalOrder)) {
    byReplica.set(fact.coordinate.dot.replicaId, fact);
  }
  return [...byReplica.values()].sort((left, right) =>
    stableStringCompare(left.coordinate.dot.replicaId, right.coordinate.dot.replicaId),
  );
}

function observedDeletionActionIds(facts: readonly Fact[], acknowledgement: Fact, nodeId: string): readonly string[] {
  const observedFacts = facts.filter((fact) => factObserves(acknowledgement, fact));
  const observedActions = factActionsFromFacts(observedFacts);
  const activeIds = deriveActivation(observedFacts, "origin", observedActions).activeActionIds;
  const active = observedActions.filter((action) => activeIds.has(action.id));
  return [...(nodeDeletionActionIds(active).get(nodeId) ?? [])].sort(stableStringCompare);
}

function currentOccurrenceReferences(active: readonly FactAction[], nodeId: string): string[] {
  const removals = factActionsOfKind(active, "placement-remove");
  return active
    .flatMap((action) => {
      const placement = createdPlacement(action);
      if (
        placement?.nodeId !== nodeId ||
        removals.some(
          (removal) => removal.action.placementId === placement.placementId && actionObserves(removal, action),
        )
      ) {
        return [];
      }
      return [placement.placementId];
    })
    .filter(unique)
    .sort(stableStringCompare);
}

function createdPlacement(action: FactAction): Readonly<{ placementId: string; nodeId: string }> | null {
  const authoredAction = action.action;
  if (authoredAction.kind === "node-create" && authoredAction.originalPlacement !== null) {
    return { placementId: authoredAction.originalPlacement.placementId, nodeId: authoredAction.nodeId };
  }
  return authoredAction.kind === "placement-create"
    ? { placementId: authoredAction.placementId, nodeId: authoredAction.nodeId }
    : null;
}

function actionObserves(observer: FactAction, observed: FactAction): boolean {
  return observer.factId === observed.factId ? observer.index > observed.index : factObserves(observer, observed);
}

function currentSupertagApplicationOwners(active: readonly FactAction[], supertagId: string): string[] {
  const additions = factActionsOfKind(active, "supertag-application-add").filter(
    (fact) => fact.action.supertagId === supertagId,
  );
  const removals = factActionsOfKind(active, "supertag-membership-remove").filter(
    (fact) => fact.action.supertagId === supertagId,
  );
  return additions
    .flatMap((addition) => {
      const ownerNodeId = addition.action.hostNodeId;
      const removed = removals.some(
        (removal) =>
          removal.action.hostNodeId === addition.action.hostNodeId &&
          removal.action.supertagId === addition.action.supertagId &&
          factObserves(removal, addition),
      );
      return removed ? [] : [ownerNodeId];
    })
    .filter(unique)
    .sort(stableStringCompare);
}

function unique(value: string, index: number, values: readonly string[]): boolean {
  return value.length > 0 && values.indexOf(value) === index;
}
