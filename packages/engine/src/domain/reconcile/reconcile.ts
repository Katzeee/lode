import {
  compareFacts,
  frontierCovers,
  frontierEquals,
  type Fact,
  type FactSnapshot,
} from "../fact/index.js";
import type { OwnerKey } from "./owner-dag.js";
import { advanceDirectProjection } from "./incremental-projection.js";
import {
  PROJECTION_OWNER_DAG,
  projectWithOwnerPlan,
  type ProjectionOwnerObserver,
} from "./projection-owner-plan.js";
import {
  assertSupportedProjectionVersions,
  type ProjectionGeneration,
  type ProjectionVersions,
} from "./projection-types.js";

export type ReconcileStats = Readonly<{
  evaluatedOwners: readonly OwnerKey[];
  supportPasses: number;
}>;

export type ReconcileResult = Readonly<{
  generation: ProjectionGeneration;
  stats: ReconcileStats;
}>;

export type ReconcileOptions = Readonly<{ ownerObserver?: ProjectionOwnerObserver }>;

export function rebuildGeneration(
  workspaceId: string,
  snapshot: FactSnapshot,
  versions: ProjectionVersions,
  options: ReconcileOptions = {},
): ReconcileResult {
  assertSupportedProjectionVersions(versions);
  const origin = projectWithOwnerPlan(
    workspaceId,
    snapshot,
    "origin",
    versions,
    options.ownerObserver,
  );
  const review = projectWithOwnerPlan(
    workspaceId,
    snapshot,
    "review",
    versions,
    options.ownerObserver,
  );
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
      ownerCaches: { origin: origin.ownerCache, review: review.ownerCache },
    },
    stats: {
      evaluatedOwners: PROJECTION_OWNER_DAG.ordered.map((owner) => owner.key),
      supportPasses: Math.max(origin.ownerCache.supportPasses, review.ownerCache.supportPasses),
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
  const invalidated = invalidatedOwners(changed);
  const selectedOwners = new Set(PROJECTION_OWNER_DAG.downstream(invalidated));
  if (changed.some((fact) => fact.body.kind === "contribution")) {
    selectedOwners.add("activation");
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
      previousGeneration.ownerCaches.origin,
      nextSnapshot,
      changed,
      versions,
      selectedOwners,
      options.ownerObserver,
    );
    const review = advanceDirectProjection(
      workspaceId,
      previousGeneration.review,
      previousGeneration.ownerCaches.review,
      nextSnapshot,
      changed,
      versions,
      selectedOwners,
      options.ownerObserver,
    );
    if (origin && review) {
      return {
        generation: {
          identity: origin.projection.identity,
          origin: origin.projection,
          review: review.projection,
          ownerCaches: { origin: origin.ownerCache, review: review.ownerCache },
        },
        stats: { evaluatedOwners: origin.evaluatedOwners, supportPasses: 0 },
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

function invalidatedOwners(facts: readonly Fact[]): ReadonlySet<OwnerKey> {
  const owners = new Set<OwnerKey>();
  for (const fact of facts) {
    if (fact.body.kind === "resolution" || fact.body.intent === "proposal") {
      for (const owner of PROJECTION_OWNER_DAG.ordered) {
        owners.add(owner.key);
      }
      continue;
    }
    switch (fact.body.mutation.kind) {
      case "node-create":
      case "node-delete":
      case "node-restore":
        owners.add("node");
        break;
      case "occurrence-create":
      case "occurrence-delete":
      case "occurrence-restore":
      case "occurrence-move":
        owners.add("occurrence");
        break;
      case "text-splice":
      case "text-mark":
        owners.add("text");
        break;
      case "value-set":
      case "value-unset":
        owners.add("value");
        break;
      case "schema-apply":
      case "schema-remove":
      case "schema-field-add":
      case "schema-field-remove":
      case "schema-field-configure":
      case "schema-extension-add":
      case "schema-extension-remove":
      case "field-materialize":
      case "field-initialize":
        owners.add("schema");
        break;
      case "canonical-occurrence-set":
        owners.add("canonical");
        break;
    }
  }
  return owners;
}
