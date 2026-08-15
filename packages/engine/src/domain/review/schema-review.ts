import { canonicalJson, isSchemaMutation, type ContributionFact, type SchemaMutation } from "../fact/index.js";
import { impactAddress, type ScopedProjection, type ScopedProjectionGeneration } from "../reconcile/index.js";
import type { SchemaRelationDecisionEffect } from "./types.js";
import { addAffectedFieldImpacts } from "./field-impacts.js";

export function schemaRelationEffect(
  fact: ContributionFact,
  generation: ScopedProjectionGeneration,
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
  generation: ScopedProjectionGeneration,
): void {
  const mutation = fact.body.mutation;
  if (!isSchemaMutation(mutation)) {
    return;
  }
  if (mutation.kind === "schema-template-node-add" || mutation.kind === "schema-template-node-remove") {
    impacts.add(schemaRelationAddress(mutation));
    for (const instance of [...generation.origin.templateNodeInstances, ...generation.review.templateNodeInstances]) {
      if (
        instance.templateNodeId === mutation.templateNodeId &&
        instance.sources.some((source) => source.schemaId === mutation.schemaId)
      ) {
        impacts.add(instance.instanceOccurrenceId);
        impacts.add(impactAddress("template-node", instance.ownerNodeId, instance.templateNodeId));
      }
    }
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
        ? [...fieldsOfSchema(generation, mutation.schemaId), ...fieldsOfSchema(generation, mutation.baseSchemaId)]
        : [mutation.fieldDefinitionId];
  impacts.add(schemaRelationAddress(mutation));
  for (const nodeId of nodeIds) {
    for (const fieldDefinitionId of fieldIds) {
      const origin = effectiveField(generation.origin, nodeId, fieldDefinitionId);
      const review = effectiveField(generation.review, nodeId, fieldDefinitionId);
      if (canonicalJson(origin) !== canonicalJson(review)) {
        addAffectedFieldImpacts(impacts, nodeId, fieldDefinitionId, generation);
      }
    }
  }
}

export function schemaRelationAddress(mutation: SchemaMutation): string {
  if (mutation.kind === "schema-apply" || mutation.kind === "schema-remove") {
    return impactAddress("schema-application", mutation.nodeId, mutation.schemaId);
  }
  if (mutation.kind === "schema-extension-add" || mutation.kind === "schema-extension-remove") {
    return impactAddress("schema-extension", mutation.schemaId, mutation.baseSchemaId);
  }
  return mutation.kind === "schema-template-node-add" || mutation.kind === "schema-template-node-remove"
    ? impactAddress("schema-template-node", mutation.schemaId, mutation.templateNodeId)
    : impactAddress("schema-field", mutation.schemaId, mutation.fieldDefinitionId);
}

function relationIndex(
  projection: ScopedProjection,
  relation: SchemaRelationDecisionEffect["relation"],
  ownerId: string,
  targetId: string,
): number | null {
  const values =
    relation === "application"
      ? projection.schemaApplications[ownerId]
      : relation === "extension"
        ? projection.schemaExtensions[ownerId]
        : relation === "template-node"
          ? projection.schemaTemplateNodes[ownerId]
          : projection.schemaFields[ownerId];
  const index = values?.indexOf(targetId);
  return index === undefined || index < 0 ? null : index;
}

function schemaRelationKind(mutation: SchemaMutation): SchemaRelationDecisionEffect["relation"] {
  if (mutation.kind === "schema-apply" || mutation.kind === "schema-remove") {
    return "application";
  }
  return mutation.kind === "schema-extension-add" || mutation.kind === "schema-extension-remove"
    ? "extension"
    : mutation.kind === "schema-template-node-add" || mutation.kind === "schema-template-node-remove"
      ? "template-node"
      : "field";
}

function schemaRelationIdentities(mutation: SchemaMutation): readonly [ownerId: string, targetId: string] {
  if (mutation.kind === "schema-apply" || mutation.kind === "schema-remove") {
    return [mutation.nodeId, mutation.schemaId];
  }
  return mutation.kind === "schema-extension-add" || mutation.kind === "schema-extension-remove"
    ? [mutation.schemaId, mutation.baseSchemaId]
    : mutation.kind === "schema-template-node-add" || mutation.kind === "schema-template-node-remove"
      ? [mutation.schemaId, mutation.templateNodeId]
      : [mutation.schemaId, mutation.fieldDefinitionId];
}

function fieldsOfSchema(generation: ScopedProjectionGeneration, schemaId: string): readonly string[] {
  return [
    ...new Set([
      ...(generation.origin.schemaFields[schemaId] ?? []),
      ...(generation.review.schemaFields[schemaId] ?? []),
    ]),
  ];
}

function nodesApplyingSchema(generation: ScopedProjectionGeneration, schemaId: string): readonly string[] {
  return [
    ...new Set(
      [generation.origin, generation.review].flatMap((projection) => [
        ...(projection.schemaSearchMembers[schemaId] ?? []),
        ...Object.entries(projection.schemaApplications).flatMap(([nodeId, schemaIds]) =>
          schemaIds.includes(schemaId) ? [nodeId] : [],
        ),
      ]),
    ),
  ];
}

function effectiveField(projection: ScopedProjection, nodeId: string, fieldDefinitionId: string) {
  return projection.effectiveFields[nodeId]?.find((field) => field.fieldDefinitionId === fieldDefinitionId) ?? null;
}
