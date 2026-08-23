import {
  canonicalJson,
  factActionsFromFacts,
  factObserves,
  stableStringCompare,
  type FactAction,
  type FactSnapshot,
  type ResolutionFact,
} from "../fact/index.js";
import type { ConflictIssue } from "../conflict/types.js";
import type { MutableOccurrence } from "./projection-state.js";
import { resolutionsByAction } from "../activation/index.js";
import { intrinsicNodeTypeConflicts } from "./intrinsic-node-type-conflicts.js";
import type { ProjectionPlanCache } from "./projection-types.js";

export function projectConflictIssues(
  snapshot: FactSnapshot,
  extensionConflicts: Readonly<Record<string, readonly string[]>>,
  active: readonly FactAction[],
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  nodeOwners: Readonly<Record<string, string | null>>,
  originPlanCache: ProjectionPlanCache,
): Readonly<Record<string, ConflictIssue>> {
  const resolutions = resolutionsByAction(snapshot.facts);
  const issues = [
    ...unsupportedDirectIntents(snapshot, originPlanCache, resolutions),
    ...resolutionConflicts(snapshot, resolutions),
    ...supertagExtensionConflicts(extensionConflicts),
    ...intrinsicNodeTypeConflicts(active),
    ...placementConflicts(active, occurrences),
    ...originalConflicts(active, occurrences, nodeOwners),
  ];
  return Object.fromEntries(
    issues
      .sort((left, right) => stableStringCompare(left.identity, right.identity))
      .map((issue) => [issue.identity, issue]),
  );
}

function originalConflicts(
  active: readonly FactAction[],
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  nodeOwners: Readonly<Record<string, string | null>>,
): readonly ConflictIssue[] {
  const selections = new Map<string, FactAction[]>();
  for (const action of active) {
    const authoredAction = action.action;
    if (
      (authoredAction.kind !== "node-create" || authoredAction.originalPlacement === null) &&
      authoredAction.kind !== "original-promote" &&
      authoredAction.kind !== "node-restore"
    ) {
      continue;
    }
    const candidates = selections.get(authoredAction.nodeId) ?? [];
    candidates.push(action);
    selections.set(authoredAction.nodeId, candidates);
  }
  return [...selections].flatMap(([nodeId, candidates]): readonly ConflictIssue[] => {
    const maximal = candidates.filter(
      (candidate) => !candidates.some((other) => other.id !== candidate.id && actionObserves(other, candidate)),
    );
    if (new Set(maximal.map(originalPlacementId)).size < 2) {
      return [];
    }
    const ordered = [...maximal].sort((left, right) => stableStringCompare(left.id, right.id));
    const ownerNodeId = nodeOwners[nodeId];
    const candidatePlacementIds = new Set(candidates.map(originalPlacementId));
    const canonicalPlacementId = [...occurrences.values()].find(
      (occurrence) =>
        candidatePlacementIds.has(occurrence.occurrenceId) &&
        occurrence.nodeId === nodeId &&
        occurrence.parentNodeId === ownerNodeId,
    )?.occurrenceId;
    if (canonicalPlacementId === undefined) {
      return [];
    }
    return [
      {
        kind: "original-conflict",
        identity: canonicalJson(["original-conflict", nodeId, ordered.map((action) => action.id)]),
        nodeId,
        canonicalPlacementId,
        candidates: ordered.map((action) => ({
          factActionId: action.id,
          placementId: originalPlacementId(action),
          actorId: action.actorId,
          replicaId: action.coordinate.dot.replicaId,
          observedFrontier: action.coordinate.observed,
        })),
      },
    ];
  });
}

function originalPlacementId(action: FactAction): string {
  const authoredAction = action.action;
  if (authoredAction.kind === "node-create") {
    if (authoredAction.originalPlacement !== null) {
      return authoredAction.originalPlacement.placementId;
    }
  }
  if (authoredAction.kind !== "original-promote" && authoredAction.kind !== "node-restore") {
    throw new Error("Original candidate does not select a placement");
  }
  return authoredAction.placementId;
}

function actionObserves(observer: FactAction, observed: FactAction): boolean {
  return observer.factId === observed.factId ? observer.index > observed.index : factObserves(observer, observed);
}

function unsupportedDirectIntents(
  snapshot: FactSnapshot,
  origin: ProjectionPlanCache,
  resolutions: ReturnType<typeof resolutionsByAction>,
): readonly ConflictIssue[] {
  const activeActionIds = new Set(origin.activeActionIds);
  const actions = new Map<string, FactAction>(
    factActionsFromFacts(snapshot.facts).map((fact) => [fact.id, fact] as const),
  );
  return [...actions.values()].flatMap((fact): readonly ConflictIssue[] => {
    if (fact.intent !== "direct" || activeActionIds.has(fact.id)) {
      return [];
    }
    const missingSupportActionIds = (origin.supportByAction[fact.id] ?? [])
      .filter((supportId) => !activeActionIds.has(supportId))
      .filter((supportId) => rejectedProposalSupport(resolutions, supportId))
      .sort(stableStringCompare);
    if (missingSupportActionIds.length === 0) {
      return [];
    }
    return [
      {
        kind: "unsupported-direct-intent",
        identity: canonicalJson(["unsupported-direct-intent", fact.id]),
        factActionId: fact.id,
        actionKind: fact.action.kind,
        actorId: fact.actorId,
        replicaId: fact.coordinate.dot.replicaId,
        observedFrontier: fact.coordinate.observed,
        missingSupportActionIds,
        requiredNodeIds: missingSupportActionIds
          .flatMap((supportId) => {
            const support = actions.get(supportId);
            return support?.action.kind === "node-create" ? [support.action.nodeId] : [];
          })
          .sort(stableStringCompare),
        recoveryActions: ["restore-support"],
      },
    ];
  });
}

function rejectedProposalSupport(
  resolutions: ReturnType<typeof resolutionsByAction>,
  factActionId: FactAction["id"],
): boolean {
  const decisions = new Set((resolutions.get(factActionId) ?? []).map((resolution) => resolution.body.decision));
  return decisions.size === 1 && decisions.has("reject");
}

function placementConflicts(
  active: readonly FactAction[],
  occurrences: ReadonlyMap<string, MutableOccurrence>,
): readonly ConflictIssue[] {
  const moves = new Map<string, FactAction[]>();
  for (const fact of active) {
    if (fact.action.kind === "placement-move" && occurrences.has(fact.action.placementId)) {
      const candidates = moves.get(fact.action.placementId) ?? [];
      candidates.push(fact);
      moves.set(fact.action.placementId, candidates);
    }
  }
  const issues: ConflictIssue[] = [];
  for (const [occurrenceId, candidates] of moves) {
    const maximal = candidates.filter(
      (candidate) => !candidates.some((other) => other.id !== candidate.id && factObserves(other, candidate)),
    );
    if (new Set(maximal.map((fact) => moveOf(fact).parentNodeId)).size < 2) {
      continue;
    }
    const ordered = maximal.sort((left, right) => stableStringCompare(left.id, right.id));
    issues.push({
      kind: "placement-conflict",
      identity: canonicalJson(["placement-conflict", occurrenceId, ordered.map((fact) => fact.id)]),
      occurrenceId,
      canonicalParentNodeId: occurrences.get(occurrenceId)!.parentNodeId,
      candidates: ordered.map((fact) => ({
        factActionId: fact.id,
        parentNodeId: moveOf(fact).parentNodeId,
        anchor: moveOf(fact).anchor,
        actorId: fact.actorId,
        replicaId: fact.coordinate.dot.replicaId,
        observedFrontier: fact.coordinate.observed,
      })),
    });
  }
  return issues;
}

function moveOf(fact: FactAction) {
  const authoredAction = fact.action;
  if (authoredAction.kind !== "placement-move") {
    throw new Error("Placement candidate is not an Occurrence move");
  }
  return authoredAction;
}

function resolutionConflicts(
  snapshot: FactSnapshot,
  resolutions: ReturnType<typeof resolutionsByAction>,
): readonly ConflictIssue[] {
  const groups = new Map<string, Set<string>>();
  for (const [factActionId, candidates] of resolutions) {
    if (new Set(candidates.map((candidate) => candidate.body.decision)).size < 2) {
      continue;
    }
    const key = canonicalJson(candidates.map((candidate) => candidate.id).sort());
    const targets = groups.get(key) ?? new Set<string>();
    targets.add(factActionId);
    groups.set(key, targets);
  }
  return [...groups].map(([key, targets]) => resolutionConflict(snapshot, key, targets));
}

function resolutionConflict(snapshot: FactSnapshot, key: string, targets: ReadonlySet<string>): ConflictIssue {
  const candidateIds = JSON.parse(key) as string[];
  const candidates = snapshot.facts.filter(
    (fact): fact is ResolutionFact => fact.body.kind === "resolution" && candidateIds.includes(fact.id),
  );
  return {
    kind: "resolution-conflict",
    identity: canonicalJson(["resolution-conflict", candidateIds]),
    proposalFactIds: [
      ...new Set(
        factActionsFromFacts(snapshot.facts)
          .filter((action) => targets.has(action.id))
          .map((action) => action.factId),
      ),
    ].sort(stableStringCompare),
    candidates: candidates
      .sort((left, right) => stableStringCompare(left.id, right.id))
      .map((candidate) => ({
        resolutionId: candidate.id,
        decision: candidate.body.decision,
        actorId: candidate.body.actorId,
        replicaId: candidate.coordinate.dot.replicaId,
        observedFrontier: candidate.coordinate.observed,
      })),
  };
}

function supertagExtensionConflicts(conflicts: Readonly<Record<string, readonly string[]>>): readonly ConflictIssue[] {
  const groups = new Map<string, readonly string[]>();
  for (const supertagIds of Object.values(conflicts)) {
    const ordered = [...supertagIds].sort(stableStringCompare);
    groups.set(canonicalJson(ordered), ordered);
  }
  return [...groups.values()].map((supertagIds) => ({
    kind: "supertag-extension-cycle",
    identity: canonicalJson(["supertag-extension-cycle", supertagIds]),
    supertagIds,
  }));
}
