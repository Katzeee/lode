import {
  canonicalJson,
  stableStringCompare,
  type ContributionFact,
  type SequenceAnchor,
} from "../fact/index.js";
import { impactAddress, type Projection, type ProjectionGeneration } from "../reconcile/index.js";
import { addSchemaRelationImpacts } from "./schema-review.js";

export function associatedImpacts(
  targets: readonly ContributionFact[],
  generation: ProjectionGeneration,
): readonly string[] {
  const impacts = new Set<string>();
  for (const fact of targets) {
    const mutation = fact.body.mutation;
    const nodeId = "nodeId" in mutation ? mutation.nodeId : null;
    if (nodeId) {
      for (const occurrenceId of occurrenceIdsForNode(generation, nodeId)) {
        impacts.add(occurrenceId);
      }
    }
    if ("occurrenceId" in mutation) {
      impacts.add(mutation.occurrenceId);
      const effect = structureEffect(mutation.occurrenceId, generation, mutationAnchor(mutation));
      impacts.add(
        impactAddress("occurrence", mutation.occurrenceId, "origin-parent", effect.originParentId),
      );
      impacts.add(
        impactAddress("occurrence", mutation.occurrenceId, "review-parent", effect.reviewParentId),
      );
      impacts.add(
        impactAddress("occurrence", mutation.occurrenceId, "anchor", canonicalJson(effect.anchor)),
      );
      impacts.add(
        impactAddress(
          "occurrence",
          mutation.occurrenceId,
          "origin",
          canonicalJson(effect.originRelation),
        ),
      );
      impacts.add(
        impactAddress(
          "occurrence",
          mutation.occurrenceId,
          "review",
          canonicalJson(effect.reviewRelation),
        ),
      );
    }
    if (mutation.kind === "value-set" || mutation.kind === "value-unset") {
      addValueImpacts(impacts, mutation, generation);
    }
    addSchemaRelationImpacts(impacts, fact, generation);
  }
  return [...impacts].sort(stableStringCompare);
}

export function occurrenceIdsForNode(
  generation: ProjectionGeneration,
  nodeId: string,
): readonly string[] {
  return [
    ...Object.values(generation.origin.occurrences),
    ...Object.values(generation.review.occurrences),
  ]
    .filter((occurrence) => occurrence.nodeId === nodeId)
    .map((occurrence) => occurrence.occurrenceId)
    .filter((id, index, all) => all.indexOf(id) === index)
    .sort(stableStringCompare);
}

export function structureEffect(
  occurrenceId: string,
  generation: ProjectionGeneration,
  anchor: SequenceAnchor | null,
) {
  const origin = generation.origin.occurrences[occurrenceId];
  const review = generation.review.occurrences[occurrenceId];
  return {
    kind: "structure" as const,
    occurrenceId,
    originPresent: origin !== undefined,
    reviewPresent: review !== undefined,
    originParentId: origin?.parentOccurrenceId ?? null,
    reviewParentId: review?.parentOccurrenceId ?? null,
    anchor,
    originRelation:
      origin && anchor ? placementRelation(generation.origin, occurrenceId, anchor) : null,
    reviewRelation:
      review && anchor ? placementRelation(generation.review, occurrenceId, anchor) : null,
  };
}

function addValueImpacts(
  impacts: Set<string>,
  mutation: Extract<ContributionFact["body"]["mutation"], { kind: "value-set" | "value-unset" }>,
  generation: ProjectionGeneration,
): void {
  if (mutation.owner.kind === "node") {
    for (const occurrenceId of occurrenceIdsForNode(generation, mutation.owner.id)) {
      impacts.add(occurrenceId);
    }
    for (const child of managedChildrenFor(mutation.owner.kind, mutation.owner.id, generation)) {
      addManagedChildConsequence(impacts, child.occurrenceId, generation);
    }
    return;
  }
  if (mutation.owner.kind === "occurrence") {
    impacts.add(mutation.owner.id);
    return;
  }
  impacts.add(impactAddress("value-owner", mutation.owner.kind, mutation.owner.id));
  for (const child of managedChildrenFor(mutation.owner.kind, mutation.owner.id, generation)) {
    addManagedChildConsequence(impacts, child.occurrenceId, generation);
  }
}

function managedChildrenFor(
  ownerKind: "node" | "occurrence" | "schema" | "field",
  ownerId: string,
  generation: ProjectionGeneration,
) {
  const byOccurrence = new Map(
    [...generation.origin.managedChildren, ...generation.review.managedChildren].map((child) => [
      child.occurrenceId,
      child,
    ]),
  );
  return [...byOccurrence.values()].filter(
    (child) =>
      (ownerKind === "node" && child.parentNodeId === ownerId) ||
      (ownerKind === "schema" && child.schemaId === ownerId) ||
      (ownerKind === "field" && child.fieldId === ownerId),
  );
}

function addManagedChildConsequence(
  impacts: Set<string>,
  occurrenceId: string,
  generation: ProjectionGeneration,
): void {
  impacts.add(occurrenceId);
  for (const view of ["origin", "review"] as const) {
    const occurrence = generation[view].occurrences[occurrenceId];
    impacts.add(
      impactAddress(
        "managed-child",
        occurrenceId,
        view,
        canonicalJson(
          occurrence
            ? {
                present: true,
                parentOccurrenceId: occurrence.parentOccurrenceId,
                managed: occurrence.managed,
                metadata: occurrence.metadata,
              }
            : { present: false },
        ),
      ),
    );
  }
}

function placementRelation(projection: Projection, occurrenceId: string, anchor: SequenceAnchor) {
  const occurrence = projection.occurrences[occurrenceId];
  if (!occurrence) {
    return null;
  }
  const siblings = projection.children[occurrence.parentOccurrenceId ?? "$root"] ?? [];
  const index = siblings.indexOf(occurrenceId);
  return {
    parentMatches: true,
    afterEndpoint: endpointRelation(siblings, index, anchor.after),
    beforeEndpoint: endpointRelation(siblings, index, anchor.before),
  };
}

function endpointRelation(
  siblings: readonly string[],
  targetIndex: number,
  endpoint: string | null,
): "before" | "after" | "missing" | null {
  if (endpoint === null) {
    return null;
  }
  const endpointIndex = siblings.indexOf(endpoint);
  return endpointIndex < 0 ? "missing" : targetIndex < endpointIndex ? "before" : "after";
}

export function mutationAnchor(
  mutation: ContributionFact["body"]["mutation"],
): SequenceAnchor | null {
  switch (mutation.kind) {
    case "occurrence-create":
    case "occurrence-restore":
    case "occurrence-move":
      return mutation.anchor;
    case "occurrence-delete":
      return mutation.previousAnchor ?? null;
    case "node-create":
    case "node-delete":
    case "node-restore":
    case "canonical-occurrence-set":
    case "text-splice":
    case "text-mark":
    case "value-set":
    case "value-unset":
    case "schema-apply":
    case "schema-remove":
    case "schema-field-add":
    case "schema-field-remove":
    case "schema-field-configure":
    case "schema-extension-add":
    case "schema-extension-remove":
    case "field-materialize":
    case "field-initialize":
      return null;
  }
}
