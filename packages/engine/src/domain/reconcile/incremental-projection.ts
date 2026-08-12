import {
  compareFacts,
  type ContributionFact,
  type Fact,
  type FactSnapshot,
} from "../fact/index.js";
import type { OwnerKey } from "./owner-dag.js";
import { advanceWithOwnerPlan, type ProjectionOwnerObserver } from "./projection-owner-plan.js";
import type { Projection, ProjectionOwnerCache, ProjectionVersions } from "./projection-types.js";

export function advanceDirectProjection(
  workspaceId: string,
  previous: Projection,
  previousCache: ProjectionOwnerCache,
  snapshot: FactSnapshot,
  changed: readonly Fact[],
  versions: ProjectionVersions,
  selectedOwners: ReadonlySet<OwnerKey>,
  observer?: ProjectionOwnerObserver,
): Readonly<{
  projection: Projection;
  ownerCache: ProjectionOwnerCache;
  evaluatedOwners: readonly OwnerKey[];
}> | null {
  const orderedTail = suffixInNeutralOrder(snapshot.facts, changed);
  if (!orderedTail) {
    return null;
  }
  const contributions = eligibleContributions(previous, orderedTail);
  if (!contributions) {
    return null;
  }
  return advanceWithOwnerPlan(
    workspaceId,
    previous,
    previousCache,
    snapshot,
    contributions,
    versions,
    selectedOwners,
    observer,
  );
}

function suffixInNeutralOrder(
  facts: readonly Fact[],
  changed: readonly Fact[],
): readonly Fact[] | null {
  const changedIds = new Set(changed.map((fact) => fact.id));
  const ordered = [...facts].sort(compareFacts);
  const firstChanged = ordered.findIndex((fact) => changedIds.has(fact.id));
  if (
    firstChanged < 0 ||
    ordered.slice(0, firstChanged).some((fact) => changedIds.has(fact.id)) ||
    ordered.slice(firstChanged).some((fact) => !changedIds.has(fact.id))
  ) {
    return null;
  }
  return ordered.slice(firstChanged);
}

function eligibleContributions(
  projection: Projection,
  changed: readonly Fact[],
): readonly ContributionFact[] | null {
  const contributions = changed.filter(
    (fact): fact is ContributionFact => fact.body.kind === "contribution",
  );
  return contributions.length === changed.length &&
    contributions.every(
      (fact) => fact.body.intent === "direct" && canApplyDirectTail(projection, fact.body.mutation),
    )
    ? contributions
    : null;
}

function canApplyDirectTail(
  projection: Projection,
  mutation: ContributionFact["body"]["mutation"],
): boolean {
  switch (mutation.kind) {
    case "text-splice":
    case "text-mark":
      return projection.nodes[mutation.nodeId] !== undefined;
    case "value-set":
    case "value-unset":
      return (
        mutation.owner.kind === "schema" ||
        mutation.owner.kind === "field" ||
        (mutation.owner.kind === "node"
          ? projection.nodes[mutation.owner.id] !== undefined
          : projection.occurrences[mutation.owner.id] !== undefined)
      );
    case "canonical-occurrence-set":
      return (
        projection.nodes[mutation.nodeId] !== undefined &&
        projection.occurrences[mutation.occurrenceId]?.nodeId === mutation.nodeId
      );
    case "node-create":
      return projection.nodes[mutation.nodeId] === undefined;
    case "node-delete":
      return projection.nodes[mutation.nodeId] !== undefined;
    case "node-restore":
      return projection.nodes[mutation.nodeId] === undefined;
    case "occurrence-create":
      return (
        projection.occurrences[mutation.occurrenceId] === undefined &&
        projection.nodes[mutation.nodeId] !== undefined &&
        (mutation.parentOccurrenceId === null ||
          projection.occurrences[mutation.parentOccurrenceId] !== undefined)
      );
    case "occurrence-delete":
      return projection.occurrences[mutation.occurrenceId] !== undefined;
    case "occurrence-restore":
      return (
        projection.occurrences[mutation.occurrenceId] === undefined &&
        (mutation.parentOccurrenceId === null ||
          projection.occurrences[mutation.parentOccurrenceId] !== undefined)
      );
    case "occurrence-move":
      return (
        projection.occurrences[mutation.occurrenceId] !== undefined &&
        (mutation.parentOccurrenceId === null ||
          projection.occurrences[mutation.parentOccurrenceId] !== undefined)
      );
  }
}
