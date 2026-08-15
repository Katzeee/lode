import {
  compareFacts,
  isSchemaMutation,
  type ContributionFact,
  type Mutation,
  type SchemaMutation,
} from "../fact/index.js";
import { sequenceAnchorAt, type ScopedProjection } from "../reconcile/index.js";
import { noCompensation, type CompensationStep } from "./compensation-types.js";

export function compensateSchemaMutation(
  target: ContributionFact,
  activeFacts: readonly ContributionFact[],
  projection: ScopedProjection,
): CompensationStep | null {
  const mutation = target.body.mutation;
  if (!isSchemaMutation(mutation)) {
    return null;
  }
  if (hasLaterRelationEdit(target, activeFacts)) {
    return noCompensation();
  }
  if (mutation.kind === "schema-apply") {
    return contains(projection, mutation)
      ? ready({
          kind: "schema-remove",
          nodeId: mutation.nodeId,
          schemaId: mutation.schemaId,
          previousAnchor: currentAnchor(projection.schemaApplications[mutation.nodeId] ?? [], mutation.schemaId),
        })
      : noCompensation();
  }
  if (mutation.kind === "schema-remove") {
    return !contains(projection, mutation) && mutation.previousAnchor
      ? ready({
          kind: "schema-apply",
          nodeId: mutation.nodeId,
          schemaId: mutation.schemaId,
          anchor: mutation.previousAnchor,
        })
      : noCompensation();
  }
  if (mutation.kind === "schema-field-add") {
    return contains(projection, mutation)
      ? ready({
          kind: "schema-field-remove",
          schemaId: mutation.schemaId,
          fieldDefinitionId: mutation.fieldDefinitionId,
          fieldNodeId: mutation.fieldNodeId,
          fieldOccurrenceId: mutation.fieldOccurrenceId,
          previousAnchor: currentAnchor(projection.children[mutation.schemaId] ?? [], mutation.fieldOccurrenceId),
        })
      : noCompensation();
  }
  if (mutation.kind === "schema-field-remove") {
    return !contains(projection, mutation) && mutation.previousAnchor
      ? ready({
          kind: "schema-field-add",
          schemaId: mutation.schemaId,
          fieldDefinitionId: mutation.fieldDefinitionId,
          fieldNodeId: mutation.fieldNodeId,
          fieldOccurrenceId: mutation.fieldOccurrenceId,
          anchor: mutation.previousAnchor,
        })
      : noCompensation();
  }
  if (mutation.kind === "schema-field-configure") {
    return mutation.previousConfig == null
      ? noCompensation()
      : ready({
          kind: "schema-field-configure",
          schemaId: mutation.schemaId,
          fieldDefinitionId: mutation.fieldDefinitionId,
          fieldNodeId: mutation.fieldNodeId,
          config: mutation.previousConfig,
          previousConfig: mutation.config,
          observedConfigFactIds: [target.id],
        });
  }
  if (mutation.kind === "schema-extension-add") {
    return contains(projection, mutation)
      ? ready({
          kind: "schema-extension-remove",
          schemaId: mutation.schemaId,
          baseSchemaId: mutation.baseSchemaId,
          previousAnchor: currentAnchor(projection.schemaExtensions[mutation.schemaId] ?? [], mutation.baseSchemaId),
        })
      : noCompensation();
  }
  if (mutation.kind === "schema-extension-remove") {
    return !contains(projection, mutation) && mutation.previousAnchor
      ? ready({
          kind: "schema-extension-add",
          schemaId: mutation.schemaId,
          baseSchemaId: mutation.baseSchemaId,
          anchor: mutation.previousAnchor,
        })
      : noCompensation();
  }
  return compensateTemplateNodeRelation(mutation, projection);
}

function compensateTemplateNodeRelation(
  mutation: Extract<Mutation, { kind: "schema-template-node-add" | "schema-template-node-remove" }>,
  projection: ScopedProjection,
): CompensationStep {
  if (mutation.kind === "schema-template-node-add") {
    return contains(projection, mutation)
      ? ready({
          kind: "schema-template-node-remove",
          schemaId: mutation.schemaId,
          templateNodeId: mutation.templateNodeId,
          templateOccurrenceId: mutation.templateOccurrenceId,
          previousAnchor: currentAnchor(projection.children[mutation.schemaId] ?? [], mutation.templateOccurrenceId),
        })
      : noCompensation();
  }
  return !contains(projection, mutation) && mutation.previousAnchor
    ? ready({
        kind: "schema-template-node-add",
        schemaId: mutation.schemaId,
        templateNodeId: mutation.templateNodeId,
        templateOccurrenceId: mutation.templateOccurrenceId,
        anchor: mutation.previousAnchor,
      })
    : noCompensation();
}

function ready(mutation: Mutation): CompensationStep {
  return { kind: "ready", mutations: [mutation] };
}

function contains(projection: ScopedProjection, mutation: SchemaMutation): boolean {
  if (mutation.kind === "schema-apply" || mutation.kind === "schema-remove") {
    return (projection.schemaApplications[mutation.nodeId] ?? []).includes(mutation.schemaId);
  }
  if (
    mutation.kind === "schema-field-add" ||
    mutation.kind === "schema-field-remove" ||
    mutation.kind === "schema-field-configure"
  ) {
    return (projection.templateFields[mutation.schemaId] ?? []).some(
      (field) => field.fieldNodeId === mutation.fieldNodeId,
    );
  }
  if (mutation.kind === "schema-extension-add" || mutation.kind === "schema-extension-remove") {
    return (projection.schemaExtensions[mutation.schemaId] ?? []).includes(mutation.baseSchemaId);
  }
  const occurrence = projection.occurrences[mutation.templateOccurrenceId];
  return occurrence?.nodeId === mutation.templateNodeId && occurrence.parentNodeId === mutation.schemaId;
}

function currentAnchor(identities: readonly string[], identity: string) {
  return sequenceAnchorAt(identities, identities.indexOf(identity));
}

function hasLaterRelationEdit(target: ContributionFact, activeFacts: readonly ContributionFact[]): boolean {
  const mutation = target.body.mutation;
  if (!isSchemaMutation(mutation)) {
    return false;
  }
  return activeFacts.some(
    (fact) =>
      compareFacts(target, fact) < 0 &&
      isSchemaMutation(fact.body.mutation) &&
      relationOwner(fact.body.mutation) === relationOwner(mutation),
  );
}

function relationOwner(mutation: SchemaMutation): string {
  if (mutation.kind === "schema-apply" || mutation.kind === "schema-remove") {
    return JSON.stringify(["application", mutation.nodeId, mutation.schemaId]);
  }
  if (
    mutation.kind === "schema-field-add" ||
    mutation.kind === "schema-field-remove" ||
    mutation.kind === "schema-field-configure"
  ) {
    return JSON.stringify(["field", mutation.fieldNodeId]);
  }
  if (mutation.kind === "schema-extension-add" || mutation.kind === "schema-extension-remove") {
    return JSON.stringify(["extension", mutation.schemaId, mutation.baseSchemaId]);
  }
  return JSON.stringify(["template-node", mutation.schemaId, mutation.templateNodeId]);
}
