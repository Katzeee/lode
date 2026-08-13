import {
  compareFacts,
  frontierCovers,
  frontierEquals,
  type Fact,
  type FactSnapshot,
} from "../fact/index.js";
import type { ProjectionStageKey } from "./projection-plan-dag.js";
import { advanceDirectProjection } from "./incremental-projection.js";
import { PROJECTION_PLAN, type ProjectionStageObserver } from "./projection-plan.js";
import { projectWithPlan } from "./projection-plan-api.js";
import {
  assertSupportedProjectionVersions,
  type ProjectionGeneration,
  type ProjectionVersions,
} from "./projection-types.js";

export type ReconcileStats = Readonly<{
  evaluatedStages: readonly ProjectionStageKey[];
  supportPasses: number;
}>;

export type ReconcileResult = Readonly<{
  generation: ProjectionGeneration;
  stats: ReconcileStats;
}>;

export type ReconcileOptions = Readonly<{ stageObserver?: ProjectionStageObserver }>;

export function rebuildGeneration(
  workspaceId: string,
  snapshot: FactSnapshot,
  versions: ProjectionVersions,
  options: ReconcileOptions = {},
): ReconcileResult {
  assertSupportedProjectionVersions(versions);
  const origin = projectWithPlan(workspaceId, snapshot, "origin", versions, options.stageObserver);
  const review = projectWithPlan(workspaceId, snapshot, "review", versions, options.stageObserver);
  if (
    origin.projection.identity.generationId !== review.projection.identity.generationId ||
    !frontierEquals(origin.projection.identity.frontier, review.projection.identity.frontier)
  ) {
    throw new Error("Origin and Review cannot form one Projection Generation");
  }
  return {
    generation: {
      identity: origin.projection.identity,
      origin: origin.projection,
      review: review.projection,
      planCaches: { origin: origin.planCache, review: review.planCache },
    },
    stats: {
      evaluatedStages: PROJECTION_PLAN.ordered.map((stage) => stage.key),
      supportPasses: Math.max(origin.planCache.supportPasses, review.planCache.supportPasses),
    },
  };
}

export function advanceGeneration(
  workspaceId: string,
  previousSnapshot: FactSnapshot,
  nextSnapshot: FactSnapshot,
  versions: ProjectionVersions,
  previousGeneration?: ProjectionGeneration,
  options: ReconcileOptions = {},
): ReconcileResult {
  assertSupportedProjectionVersions(versions);
  if (!frontierCovers(nextSnapshot.frontier, previousSnapshot.frontier)) {
    throw new Error("Incremental snapshot does not contain the previous frontier");
  }
  const previousIds = new Set(previousSnapshot.facts.map((fact) => fact.id));
  const changed = nextSnapshot.facts.filter((fact) => !previousIds.has(fact.id));
  const invalidated = invalidatedStages(changed);
  const selectedStages = new Set(PROJECTION_PLAN.downstream(invalidated));
  if (changed.some((fact) => fact.body.kind === "contribution")) {
    selectedStages.add("activation");
  }
  if (
    previousGeneration &&
    frontierEquals(previousGeneration.identity.frontier, previousSnapshot.frontier) &&
    previousGeneration.identity.rulesVersion === versions.rulesVersion &&
    previousGeneration.identity.schemaVersion === versions.schemaVersion
  ) {
    const origin = advanceDirectProjection(
      workspaceId,
      previousGeneration.origin,
      previousGeneration.planCaches.origin,
      nextSnapshot,
      changed,
      versions,
      selectedStages,
      options.stageObserver,
    );
    const review = advanceDirectProjection(
      workspaceId,
      previousGeneration.review,
      previousGeneration.planCaches.review,
      nextSnapshot,
      changed,
      versions,
      selectedStages,
      options.stageObserver,
    );
    if (origin && review) {
      return {
        generation: {
          identity: origin.projection.identity,
          origin: origin.projection,
          review: review.projection,
          planCaches: { origin: origin.planCache, review: review.planCache },
        },
        stats: { evaluatedStages: origin.evaluatedStages, supportPasses: 0 },
      };
    }
  }
  const result = rebuildGeneration(workspaceId, nextSnapshot, versions, options);
  return {
    generation: result.generation,
    stats: result.stats,
  };
}

export function snapshotAtFrontier(
  snapshot: FactSnapshot,
  frontier: Readonly<Record<string, number>>,
): FactSnapshot {
  if (!frontierCovers(snapshot.frontier, frontier)) {
    throw new Error("Requested frontier is not covered by the Fact snapshot");
  }
  return {
    facts: snapshot.facts
      .filter(
        (fact) => fact.coordinate.dot.sequence <= (frontier[fact.coordinate.dot.replicaId] ?? 0),
      )
      .sort(compareFacts),
    frontier,
  };
}

function invalidatedStages(facts: readonly Fact[]): ReadonlySet<ProjectionStageKey> {
  const stages = new Set<ProjectionStageKey>();
  for (const fact of facts) {
    if (fact.body.kind === "maintenance" || fact.body.kind === "resolution") {
      for (const stage of PROJECTION_PLAN.ordered) {
        stages.add(stage.key);
      }
      continue;
    }
    if (fact.body.intent === "proposal") {
      for (const stage of PROJECTION_PLAN.ordered) {
        stages.add(stage.key);
      }
      continue;
    }
    switch (fact.body.mutation.kind) {
      case "node-create":
      case "node-delete":
      case "node-restore":
      case "schema-field-add":
      case "template-node-detach":
      case "field-initialize":
        stages.add("node");
        break;
      case "occurrence-create":
      case "occurrence-delete":
      case "occurrence-restore":
      case "occurrence-move":
      case "field-value-delete":
      case "materialized-field-delete":
      case "schema-field-remove":
      case "schema-template-node-add":
      case "schema-template-node-remove":
        stages.add("occurrence");
        break;
      case "text-splice":
      case "text-mark":
        stages.add("text");
        break;
      case "value-set":
      case "value-unset":
        stages.add("value");
        break;
      case "schema-apply":
      case "schema-remove":
      case "schema-field-configure":
      case "schema-extension-add":
      case "schema-extension-remove":
      case "field-materialize":
        stages.add("schema");
        break;
      case "node-owner-set":
        stages.add("owner");
        break;
    }
  }
  return stages;
}
