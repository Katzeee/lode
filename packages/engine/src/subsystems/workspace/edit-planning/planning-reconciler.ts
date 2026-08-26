import {
  normalizeFrontier,
  factId,
  factActionId,
  type ActorId,
  type EditIntent,
  type Fact,
  type FactSnapshot,
  type FactActionId,
  type GraphAction,
  type ReplicaId,
} from "../../../domain/fact/index.js";
import {
  rebuildGeneration,
  type ProjectionGeneration,
  type ProjectionVersions,
} from "../../../domain/reconcile/index.js";
import { createPlanningFact } from "./planning-fact.js";

type PlanningReconciler = Readonly<{
  reconcileEdit(
    editIndex: number,
    actions: readonly [GraphAction, ...GraphAction[]],
    intent: EditIntent,
  ): Readonly<{
    snapshot: FactSnapshot;
    generation: ProjectionGeneration;
  }>;
  facts(): readonly Fact[];
  actionId(editIndex: number, actionIndex: number): FactActionId;
}>;

export function planningReconciler(
  workspaceId: string,
  actorId: ActorId,
  base: FactSnapshot,
  versions: ProjectionVersions,
  replicaId: ReplicaId,
): PlanningReconciler {
  const firstSequence = (base.frontier[replicaId] ?? 0) + 1;
  const firstLamport = base.facts.reduce((maximum, fact) => Math.max(maximum, fact.coordinate.lamport), 0) + 1;
  const factsByEdit = new Map<number, Fact>();
  return {
    reconcileEdit(editIndex, actions, intent) {
      const beforeEdit = planningSnapshot(base, factsByEdit, replicaId, editIndex);
      const editFact = createPlanningFact(
        workspaceId,
        replicaId,
        firstSequence + editIndex,
        beforeEdit.frontier,
        firstLamport + editIndex,
        actorId,
        intent,
        actions,
      );
      factsByEdit.set(editIndex, editFact);
      const snapshot = planningSnapshot(base, factsByEdit, replicaId);
      return {
        snapshot,
        generation: rebuildGeneration(workspaceId, snapshot, versions),
      };
    },
    facts: () => planningFacts(factsByEdit),
    actionId: (editIndex, actionIndex) =>
      factActionId(factId(workspaceId, replicaId, firstSequence + editIndex), actionIndex),
  };
}

function planningSnapshot(
  base: FactSnapshot,
  factsByEdit: ReadonlyMap<number, Fact>,
  replicaId: ReplicaId,
  beforeEditIndex = Number.POSITIVE_INFINITY,
): FactSnapshot {
  const planningFacts = planningFactsBefore(factsByEdit, beforeEditIndex);
  const facts = [...base.facts, ...planningFacts];
  const latestSequence = planningFacts.at(-1)?.coordinate.dot.sequence;
  return {
    facts,
    frontier:
      latestSequence === undefined
        ? base.frontier
        : normalizeFrontier({ ...base.frontier, [replicaId]: latestSequence }),
  };
}

function planningFacts(factsByEdit: ReadonlyMap<number, Fact>): readonly Fact[] {
  return planningFactsBefore(factsByEdit, Number.POSITIVE_INFINITY);
}

function planningFactsBefore(factsByEdit: ReadonlyMap<number, Fact>, beforeEditIndex: number): readonly Fact[] {
  return [...factsByEdit]
    .filter(([editIndex]) => editIndex < beforeEditIndex)
    .sort(([left], [right]) => left - right)
    .map(([, fact]) => fact);
}
