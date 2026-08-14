import {
  frontierOf,
  type ActorId,
  type EditIntent,
  type Fact,
  type FactSnapshot,
  type Mutation,
} from "../../../domain/fact/index.js";
import {
  rebuildGeneration,
  type ProjectionGeneration,
  type ProjectionVersions,
} from "../../../domain/reconcile/index.js";
import { createPlanningTransaction } from "./planning-fact.js";

export type PlanningReconciler = Readonly<{
  reconcileEdit(
    editIndex: number,
    mutations: readonly [Mutation, ...Mutation[]],
    intent: EditIntent,
  ): Readonly<{
    snapshot: FactSnapshot;
    generation: ProjectionGeneration;
    latestFact: Fact;
  }>;
}>;

export function planningReconciler(
  workspaceId: string,
  actorId: ActorId,
  base: FactSnapshot,
  versions: ProjectionVersions,
): PlanningReconciler {
  const factsByEdit = new Map<number, readonly Fact[]>();
  return {
    reconcileEdit(editIndex, mutations, intent) {
      const beforeEdit = planningSnapshot(base, factsByEdit, editIndex);
      const editFacts = createPlanningTransaction(
        workspaceId,
        beforeEdit,
        actorId,
        intent,
        mutations,
      );
      factsByEdit.set(editIndex, editFacts);
      const snapshot = planningSnapshot(base, factsByEdit);
      const latestFact = editFacts.at(-1);
      if (!latestFact) {
        throw new Error("Planning transaction did not produce a Fact");
      }
      return {
        snapshot,
        generation: rebuildGeneration(workspaceId, snapshot, versions).generation,
        latestFact,
      };
    },
  };
}

function planningSnapshot(
  base: FactSnapshot,
  factsByEdit: ReadonlyMap<number, readonly Fact[]>,
  beforeEditIndex = Number.POSITIVE_INFINITY,
): FactSnapshot {
  const planningFacts = [...factsByEdit]
    .filter(([editIndex]) => editIndex < beforeEditIndex)
    .sort(([left], [right]) => left - right)
    .flatMap(([, facts]) => facts);
  const facts = [...base.facts, ...planningFacts];
  return { facts, frontier: frontierOf(facts) };
}
