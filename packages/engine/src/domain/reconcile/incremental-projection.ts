import {
  compareFacts,
  type ContributionFact,
  type Fact,
  type FactSnapshot,
} from "../fact/index.js";
import type { ProjectionStageKey } from "./projection-plan-dag.js";
import { advanceWithPlan } from "./projection-plan-api.js";
import type { ProjectionStageObserver } from "./projection-plan.js";
import type { Projection, ProjectionPlanCache, ProjectionVersions } from "./projection-types.js";

export function advanceDirectProjection(
  workspaceId: string,
  previous: Projection,
  previousCache: ProjectionPlanCache,
  snapshot: FactSnapshot,
  changed: readonly Fact[],
  versions: ProjectionVersions,
  selectedStages: ReadonlySet<ProjectionStageKey>,
  observer?: ProjectionStageObserver,
): Readonly<{
  projection: Projection;
  planCache: ProjectionPlanCache;
  evaluatedStages: readonly ProjectionStageKey[];
}> | null {
  const orderedTail = suffixInNeutralOrder(snapshot.facts, changed);
  if (!orderedTail) {
    return null;
  }
  const contributions = eligibleContributions(previous, orderedTail);
  if (!contributions) {
    return null;
  }
  return advanceWithPlan(
    workspaceId,
    previous,
    previousCache,
    snapshot,
    contributions,
    versions,
    selectedStages,
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
  const fieldDeletionAvailable = canApplyFieldContentDeletion(projection, mutation);
  if (fieldDeletionAvailable !== null) {
    return fieldDeletionAvailable;
  }
  const occurrenceAvailable = canApplyOccurrenceMutation(projection, mutation);
  if (occurrenceAvailable !== null) {
    return occurrenceAvailable;
  }
  const schemaAvailable = canApplySchemaMutation(projection, mutation);
  if (schemaAvailable !== null) {
    return schemaAvailable;
  }
  switch (mutation.kind) {
    case "text-splice":
    case "text-mark":
      return projection.nodes[mutation.nodeId] !== undefined;
    case "value-set":
    case "value-unset":
      return mutation.target.kind === "node"
        ? projection.nodes[mutation.target.id] !== undefined
        : projection.occurrences[mutation.target.id] !== undefined;
    case "node-owner-set":
      return (
        projection.nodes[mutation.nodeId] !== undefined &&
        projection.nodes[mutation.ownerNodeId] !== undefined &&
        Object.values(projection.occurrences).some(
          (occurrence) =>
            occurrence.nodeId === mutation.nodeId &&
            occurrence.parentNodeId === mutation.ownerNodeId,
        )
      );
    case "schema-apply":
    case "schema-remove":
    case "schema-field-add":
    case "schema-field-remove":
    case "schema-field-configure":
    case "schema-extension-add":
    case "schema-extension-remove":
    case "schema-template-node-add":
    case "schema-template-node-remove":
      return false;
    case "template-node-detach":
      return projection.templateNodeInstances.some(
        (instance) =>
          instance.ownerNodeId === mutation.ownerNodeId &&
          instance.templateNodeId === mutation.templateNodeId &&
          instance.state === "linked",
      );
    case "field-materialize":
      return (
        projection.nodes[mutation.ownerNodeId] !== undefined &&
        projection.nodes[mutation.fieldDefinitionId] !== undefined &&
        projection.nodes[mutation.fieldNodeId] !== undefined &&
        projection.occurrences[mutation.fieldOccurrenceId]?.nodeId === mutation.fieldNodeId
      );
    case "field-initialize":
      return (
        projection.nodes[mutation.ownerNodeId] !== undefined &&
        projection.nodes[mutation.schemaId] !== undefined &&
        projection.nodes[mutation.fieldDefinitionId] !== undefined &&
        mutation.values.every(
          (value) => value.kind !== "reference" || projection.nodes[value.nodeId] !== undefined,
        )
      );
    case "node-create":
      return (
        projection.nodes[mutation.nodeId] === undefined &&
        !Object.values(projection.conflictIssues).some(
          (issue) =>
            issue.kind === "unsupported-direct-intent" &&
            issue.requiredNodeIds.includes(mutation.nodeId),
        )
      );
    case "node-delete":
      return projection.nodes[mutation.nodeId] !== undefined;
    case "node-restore":
      return projection.nodes[mutation.nodeId] === undefined;
    case "occurrence-create":
      return (
        projection.occurrences[mutation.occurrenceId] === undefined &&
        projection.nodes[mutation.nodeId] !== undefined &&
        projection.nodes[mutation.parentNodeId] !== undefined
      );
    case "occurrence-delete":
    case "occurrence-restore":
    case "occurrence-move":
      return canApplyOccurrenceMutation(projection, mutation) ?? false;
    case "field-value-delete":
    case "materialized-field-delete":
      return canApplyFieldContentDeletion(projection, mutation) ?? false;
  }
}

function canApplySchemaMutation(
  projection: Projection,
  mutation: ContributionFact["body"]["mutation"],
): boolean | null {
  if (mutation.kind === "schema-apply" || mutation.kind === "schema-remove") {
    return Boolean(projection.nodes[mutation.nodeId] && projection.nodes[mutation.schemaId]);
  }
  if (
    mutation.kind === "schema-template-node-add" ||
    mutation.kind === "schema-template-node-remove"
  ) {
    return Boolean(
      projection.nodes[mutation.schemaId] && projection.nodes[mutation.templateNodeId],
    );
  }
  if (
    mutation.kind === "schema-field-add" ||
    mutation.kind === "schema-field-remove" ||
    mutation.kind === "schema-field-configure" ||
    mutation.kind === "schema-extension-add" ||
    mutation.kind === "schema-extension-remove"
  ) {
    const targetId =
      "fieldDefinitionId" in mutation ? mutation.fieldDefinitionId : mutation.baseSchemaId;
    return Boolean(projection.nodes[mutation.schemaId] && projection.nodes[targetId]);
  }
  return null;
}

function canApplyOccurrenceMutation(
  projection: Projection,
  mutation: ContributionFact["body"]["mutation"],
): boolean | null {
  if (mutation.kind === "occurrence-delete") {
    return projection.occurrences[mutation.occurrenceId] !== undefined;
  }
  if (mutation.kind !== "occurrence-restore" && mutation.kind !== "occurrence-move") {
    return null;
  }
  return (
    (mutation.kind === "occurrence-restore"
      ? projection.occurrences[mutation.occurrenceId] === undefined
      : projection.occurrences[mutation.occurrenceId] !== undefined) &&
    projection.nodes[mutation.parentNodeId] !== undefined
  );
}

function canApplyFieldContentDeletion(
  projection: Projection,
  mutation: ContributionFact["body"]["mutation"],
): boolean | null {
  if (mutation.kind === "field-value-delete") {
    return projection.occurrences[mutation.valueOccurrenceId] !== undefined;
  }
  return mutation.kind === "materialized-field-delete"
    ? projection.occurrences[mutation.fieldOccurrenceId] !== undefined
    : null;
}
