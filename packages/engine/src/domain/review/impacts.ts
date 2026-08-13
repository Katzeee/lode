import {
  canonicalJson,
  stableStringCompare,
  type ContributionFact,
  type SequenceAnchor,
} from "../fact/index.js";
import { impactAddress, type Projection, type ProjectionGeneration } from "../reconcile/index.js";
import { addSchemaRelationImpacts } from "./schema-review.js";
import { addAffectedFieldImpacts } from "./field-impacts.js";
import { schemaInstanceNodeIds } from "./schema-impact-scope.js";

export function associatedImpacts(
  targets: readonly ContributionFact[],
  generation: ProjectionGeneration,
): readonly string[] {
  const impacts = new Set<string>();
  for (const fact of targets) {
    const mutation = fact.body.mutation;
    const nodeId = "nodeId" in mutation ? mutation.nodeId : null;
    if (nodeId) {
      impacts.add(nodeId);
      for (const occurrenceId of occurrenceIdsForNode(generation, nodeId)) {
        impacts.add(occurrenceId);
      }
      addDependentAuthoredImpacts(impacts, nodeId, generation);
      if (mutation.kind === "node-delete" || mutation.kind === "node-restore") {
        addDefinitionLifecycleImpacts(impacts, nodeId, generation);
      }
    }
    const occurrenceId = mutationOccurrenceId(mutation);
    if (occurrenceId) {
      impacts.add(occurrenceId);
      const effect = structureEffect(occurrenceId, generation, mutationAnchor(mutation));
      impacts.add(
        impactAddress("occurrence", occurrenceId, "origin-parent", effect.originParentId),
      );
      impacts.add(
        impactAddress("occurrence", occurrenceId, "review-parent", effect.reviewParentId),
      );
      impacts.add(
        impactAddress("occurrence", occurrenceId, "anchor", canonicalJson(effect.anchor)),
      );
      impacts.add(
        impactAddress("occurrence", occurrenceId, "origin", canonicalJson(effect.originRelation)),
      );
      impacts.add(
        impactAddress("occurrence", occurrenceId, "review", canonicalJson(effect.reviewRelation)),
      );
    }
    if (mutation.kind === "value-set" || mutation.kind === "value-unset") {
      addValueImpacts(impacts, mutation, generation);
    }
    if (mutation.kind === "template-node-detach") {
      impacts.add(mutation.ownerNodeId);
      impacts.add(mutation.templateNodeId);
      for (const instance of [
        ...generation.origin.templateNodeInstances,
        ...generation.review.templateNodeInstances,
      ]) {
        if (
          instance.ownerNodeId === mutation.ownerNodeId &&
          instance.templateNodeId === mutation.templateNodeId
        ) {
          impacts.add(instance.instanceOccurrenceId);
          if (instance.instanceNodeId !== null) {
            impacts.add(instance.instanceNodeId);
          }
        }
      }
    }
    addSchemaRelationImpacts(impacts, fact, generation);
  }
  return [...impacts].sort(stableStringCompare);
}

function addDependentAuthoredImpacts(
  impacts: Set<string>,
  nodeId: string,
  generation: ProjectionGeneration,
): void {
  const originIds = new Set(
    (generation.origin.nodes[nodeId]?.text ?? []).map((atom) => atom.contributionId),
  );
  for (const atom of generation.review.nodes[nodeId]?.text ?? []) {
    if (!originIds.has(atom.contributionId)) {
      impacts.add(atom.contributionId);
    }
  }
}

function addDefinitionLifecycleImpacts(
  impacts: Set<string>,
  definitionId: string,
  generation: ProjectionGeneration,
): void {
  const kinds = new Set([
    ...(generation.origin.nodeStatuses[definitionId]?.roles ?? []),
    ...(generation.review.nodeStatuses[definitionId]?.roles ?? []),
  ]);
  const isField =
    kinds.has("field") ||
    [generation.origin, generation.review].some((projection) =>
      Object.values(projection.effectiveFields).some((fields) =>
        fields.some((field) => field.fieldDefinitionId === definitionId),
      ),
    );
  const isSchema =
    kinds.has("schema") ||
    [generation.origin, generation.review].some(
      (projection) =>
        projection.schemaFields[definitionId] !== undefined ||
        projection.schemaSearchMembers[definitionId] !== undefined ||
        Object.values(projection.schemaApplications).some((schemas) =>
          schemas.includes(definitionId),
        ),
    );
  if (isField) {
    for (const ownerNodeId of projectionNodeIds(generation)) {
      addEffectiveFieldDifference(impacts, ownerNodeId, definitionId, generation);
      for (const field of [
        ...(generation.origin.materializedFields[ownerNodeId] ?? []),
        ...(generation.review.materializedFields[ownerNodeId] ?? []),
      ]) {
        if (field.fieldDefinitionId === definitionId) {
          impacts.add(impactAddress("materialized-field", ownerNodeId, definitionId));
          impacts.add(field.fieldNodeId);
          impacts.add(field.fieldOccurrenceId);
        }
      }
    }
  }
  if (isSchema) {
    const memberNodeIds = schemaInstanceNodeIds(generation, definitionId);
    for (const ownerNodeId of memberNodeIds) {
      impacts.add(impactAddress("schema-membership", definitionId, ownerNodeId));
      const fieldDefinitionIds = new Set([
        ...(generation.origin.effectiveFields[ownerNodeId] ?? []).map(
          (field) => field.fieldDefinitionId,
        ),
        ...(generation.review.effectiveFields[ownerNodeId] ?? []).map(
          (field) => field.fieldDefinitionId,
        ),
      ]);
      for (const fieldDefinitionId of fieldDefinitionIds) {
        addAffectedFieldImpacts(impacts, ownerNodeId, fieldDefinitionId, generation);
      }
    }
  }
}

function projectionNodeIds(generation: ProjectionGeneration): readonly string[] {
  return [
    ...new Set([...Object.keys(generation.origin.nodes), ...Object.keys(generation.review.nodes)]),
  ];
}

function addEffectiveFieldDifference(
  impacts: Set<string>,
  ownerNodeId: string,
  fieldDefinitionId: string,
  generation: ProjectionGeneration,
): void {
  const origin = effectiveField(generation.origin, ownerNodeId, fieldDefinitionId);
  const review = effectiveField(generation.review, ownerNodeId, fieldDefinitionId);
  if (canonicalJson(origin) !== canonicalJson(review)) {
    impacts.add(
      impactAddress(
        "effective-field",
        ownerNodeId,
        fieldDefinitionId,
        canonicalJson({ origin, review }),
      ),
    );
  }
}

function effectiveField(projection: Projection, nodeId: string, fieldDefinitionId: string) {
  return (
    projection.effectiveFields[nodeId]?.find(
      (field) => field.fieldDefinitionId === fieldDefinitionId,
    ) ?? null
  );
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
    originParentId: origin?.parentNodeId ?? null,
    reviewParentId: review?.parentNodeId ?? null,
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
  if (mutation.target.kind === "node") {
    for (const occurrenceId of occurrenceIdsForNode(generation, mutation.target.id)) {
      impacts.add(occurrenceId);
    }
    return;
  }
  if (mutation.target.kind === "occurrence") {
    impacts.add(mutation.target.id);
    return;
  }
  impacts.add(impactAddress("value-target", mutation.target.kind, mutation.target.id));
}

function placementRelation(projection: Projection, occurrenceId: string, anchor: SequenceAnchor) {
  const occurrence = projection.occurrences[occurrenceId];
  if (!occurrence) {
    return null;
  }
  const siblings = projection.children[occurrence.parentNodeId] ?? [];
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
    case "field-value-delete":
    case "materialized-field-delete":
      return mutation.previousAnchor ?? null;
    case "node-create":
    case "node-delete":
    case "node-restore":
    case "node-owner-set":
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
    case "schema-template-node-add":
    case "schema-template-node-remove":
    case "template-node-detach":
    case "field-materialize":
    case "field-initialize":
      return null;
  }
}

function mutationOccurrenceId(mutation: ContributionFact["body"]["mutation"]): string | null {
  if ("occurrenceId" in mutation) {
    return mutation.occurrenceId;
  }
  if (mutation.kind === "field-value-delete") {
    return mutation.valueOccurrenceId;
  }
  return mutation.kind === "materialized-field-delete" ? mutation.fieldOccurrenceId : null;
}
