import { canonicalJson, compareFacts, type ContributionFact } from "../fact/index.js";
import { impactAddress, type Projection, type ProjectionGeneration } from "../reconcile/index.js";
import type { HunkCandidate } from "./candidates.js";
import type { FieldMaterializationDecisionEffect, SchemaRelationDecisionEffect } from "./types.js";

export function schemaCandidates(
  generation: ProjectionGeneration,
  pending: ReadonlyMap<string, ContributionFact>,
): readonly HunkCandidate[] {
  const groups = new Map<string, ContributionFact[]>();
  for (const fact of pending.values()) {
    const mutation = fact.body.mutation;
    if (!isSchemaMutation(mutation)) {
      continue;
    }
    const address = schemaRelationAddress(mutation);
    const group = groups.get(address) ?? [];
    group.push(fact);
    groups.set(address, group);
  }
  return [...groups.entries()].flatMap(([address, facts]) => {
    const effect = schemaRelationEffect(facts.at(-1)!, generation);
    return effect.originIndex === effect.reviewIndex
      ? []
      : [
          {
            diffSpace: {
              kind:
                effect.relation === "application"
                  ? ("schema-application" as const)
                  : ("schema-template" as const),
              identity: address,
            },
            targets: [...facts].sort(compareFacts).map((fact) => fact.id),
            bridges: [],
          },
        ];
  });
}

export function materializedFieldCandidates(
  generation: ProjectionGeneration,
  pending: ReadonlyMap<string, ContributionFact>,
): readonly HunkCandidate[] {
  const groups = new Map<string, ContributionFact[]>();
  for (const fact of pending.values()) {
    const mutation = fact.body.mutation;
    if (mutation.kind !== "field-materialize" && mutation.kind !== "field-initialize") {
      continue;
    }
    const address = materializedFieldAddress(mutation.ownerNodeId, mutation.fieldDefinitionId);
    const group = groups.get(address) ?? [];
    group.push(fact);
    groups.set(address, group);
  }
  return [...groups.entries()].flatMap(([address, facts]) => {
    const effect = fieldMaterializationEffect(facts.at(-1)!, generation);
    return canonicalJson(effect.originFieldNodeId) === canonicalJson(effect.reviewFieldNodeId)
      ? []
      : [
          {
            diffSpace: { kind: "materialized-field" as const, identity: address },
            targets: [...facts].sort(compareFacts).map((fact) => fact.id),
            bridges: [],
          },
        ];
  });
}

export function fieldMaterializationEffect(
  fact: ContributionFact,
  generation: ProjectionGeneration,
): FieldMaterializationDecisionEffect {
  const mutation = fact.body.mutation;
  if (mutation.kind !== "field-materialize" && mutation.kind !== "field-initialize") {
    throw new Error("Field materialization effect requires a Field materialization Mutation");
  }
  const origin = materializedField(
    generation.origin,
    mutation.ownerNodeId,
    mutation.fieldDefinitionId,
  );
  const review = materializedField(
    generation.review,
    mutation.ownerNodeId,
    mutation.fieldDefinitionId,
  );
  return {
    kind: "field-materialization",
    ownerNodeId: mutation.ownerNodeId,
    fieldDefinitionId: mutation.fieldDefinitionId,
    originFieldNodeId: origin?.fieldNodeId ?? null,
    reviewFieldNodeId: review?.fieldNodeId ?? null,
    originFieldOccurrenceId: origin?.fieldOccurrenceId ?? null,
    reviewFieldOccurrenceId: review?.fieldOccurrenceId ?? null,
  };
}

export function schemaRelationEffect(
  fact: ContributionFact,
  generation: ProjectionGeneration,
): SchemaRelationDecisionEffect {
  const mutation = fact.body.mutation;
  if (!isSchemaMutation(mutation)) {
    throw new Error("Schema relation effect requires a Schema relation Mutation");
  }
  const relation = schemaRelationKind(mutation);
  const [ownerId, targetId] = schemaRelationIdentities(mutation);
  return {
    kind: "schema-relation",
    relation,
    ownerId,
    targetId,
    originIndex: relationIndex(generation.origin, relation, ownerId, targetId),
    reviewIndex: relationIndex(generation.review, relation, ownerId, targetId),
  };
}

export function addSchemaRelationImpacts(
  impacts: Set<string>,
  fact: ContributionFact,
  generation: ProjectionGeneration,
): void {
  const mutation = fact.body.mutation;
  if (mutation.kind === "field-materialize" || mutation.kind === "field-initialize") {
    impacts.add(materializedFieldAddress(mutation.ownerNodeId, mutation.fieldDefinitionId));
    if (mutation.kind === "field-materialize") {
      impacts.add(mutation.fieldNodeId);
      impacts.add(mutation.fieldOccurrenceId);
    }
    return;
  }
  if (!isSchemaMutation(mutation)) {
    return;
  }
  const nodeIds =
    mutation.kind === "schema-apply" || mutation.kind === "schema-remove"
      ? [mutation.nodeId]
      : nodesApplyingSchema(generation, mutation.schemaId);
  const fieldIds =
    mutation.kind === "schema-apply" || mutation.kind === "schema-remove"
      ? fieldsOfSchema(generation, mutation.schemaId)
      : mutation.kind === "schema-extension-add" || mutation.kind === "schema-extension-remove"
        ? [
            ...fieldsOfSchema(generation, mutation.schemaId),
            ...fieldsOfSchema(generation, mutation.baseSchemaId),
          ]
        : [mutation.fieldDefinitionId];
  impacts.add(schemaRelationAddress(mutation));
  for (const nodeId of nodeIds) {
    for (const fieldDefinitionId of fieldIds) {
      impacts.add(
        impactAddress(
          "effective-field",
          nodeId,
          fieldDefinitionId,
          canonicalJson({
            origin: effectiveField(generation.origin, nodeId, fieldDefinitionId),
            review: effectiveField(generation.review, nodeId, fieldDefinitionId),
          }),
        ),
      );
    }
  }
}

function materializedFieldAddress(ownerNodeId: string, fieldDefinitionId: string): string {
  return impactAddress("materialized-field", ownerNodeId, fieldDefinitionId);
}

function materializedField(projection: Projection, ownerNodeId: string, fieldDefinitionId: string) {
  return projection.materializedFields[ownerNodeId]?.find(
    (field) => field.fieldDefinitionId === fieldDefinitionId,
  );
}

function schemaRelationAddress(
  mutation: Extract<ContributionFact["body"]["mutation"], { kind: `schema-${string}` }>,
): string {
  if (mutation.kind === "schema-apply" || mutation.kind === "schema-remove") {
    return impactAddress("schema-application", mutation.nodeId, mutation.schemaId);
  }
  return mutation.kind === "schema-extension-add" || mutation.kind === "schema-extension-remove"
    ? impactAddress("schema-extension", mutation.schemaId, mutation.baseSchemaId)
    : impactAddress("schema-field", mutation.schemaId, mutation.fieldDefinitionId);
}

function relationIndex(
  projection: Projection,
  relation: SchemaRelationDecisionEffect["relation"],
  ownerId: string,
  targetId: string,
): number | null {
  const values =
    relation === "application"
      ? projection.schemaApplications[ownerId]
      : relation === "extension"
        ? projection.schemaExtensions[ownerId]
        : projection.schemaFields[ownerId];
  const index = values?.indexOf(targetId);
  return index === undefined || index < 0 ? null : index;
}

function schemaRelationKind(
  mutation: Extract<ContributionFact["body"]["mutation"], { kind: `schema-${string}` }>,
): SchemaRelationDecisionEffect["relation"] {
  if (mutation.kind === "schema-apply" || mutation.kind === "schema-remove") {
    return "application";
  }
  return mutation.kind === "schema-extension-add" || mutation.kind === "schema-extension-remove"
    ? "extension"
    : "field";
}

function schemaRelationIdentities(
  mutation: Extract<ContributionFact["body"]["mutation"], { kind: `schema-${string}` }>,
): readonly [ownerId: string, targetId: string] {
  if (mutation.kind === "schema-apply" || mutation.kind === "schema-remove") {
    return [mutation.nodeId, mutation.schemaId];
  }
  return mutation.kind === "schema-extension-add" || mutation.kind === "schema-extension-remove"
    ? [mutation.schemaId, mutation.baseSchemaId]
    : [mutation.schemaId, mutation.fieldDefinitionId];
}

function fieldsOfSchema(generation: ProjectionGeneration, schemaId: string): readonly string[] {
  return [
    ...new Set([
      ...(generation.origin.schemaFields[schemaId] ?? []),
      ...(generation.review.schemaFields[schemaId] ?? []),
    ]),
  ];
}

function nodesApplyingSchema(
  generation: ProjectionGeneration,
  schemaId: string,
): readonly string[] {
  return [
    ...new Set(
      [generation.origin, generation.review].flatMap((projection) =>
        Object.entries(projection.schemaApplications).flatMap(([nodeId, schemaIds]) =>
          schemaIds.includes(schemaId) ? [nodeId] : [],
        ),
      ),
    ),
  ];
}

function effectiveField(projection: Projection, nodeId: string, fieldDefinitionId: string) {
  return (
    projection.effectiveFields[nodeId]?.find(
      (field) => field.fieldDefinitionId === fieldDefinitionId,
    ) ?? null
  );
}

function isSchemaMutation(
  mutation: ContributionFact["body"]["mutation"],
): mutation is Extract<ContributionFact["body"]["mutation"], { kind: `schema-${string}` }> {
  return mutation.kind.startsWith("schema-");
}
