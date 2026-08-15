import {
  FIELD_DEFINITION_NODE_TYPE,
  SCHEMA_NODE_TYPE,
  type DefinitionNodeType,
  type Mutation,
  type SchemaMutation,
  type SequenceAnchor,
} from "../fact/index.js";
import { definitionNodeState, sequenceAnchorAt, type ScopedProjection } from "../reconcile/index.js";

export function completeSchemaMutationEvidence(
  mutation: SchemaMutation,
  previous: ScopedProjection,
  available: ScopedProjection,
): SchemaMutation {
  if (mutation.kind === "schema-field-configure") {
    return completeSchemaFieldConfigurationEvidence(mutation, available);
  }
  if (mutation.kind === "schema-apply" || mutation.kind === "schema-remove") {
    return completeApplication(mutation, previous, available);
  }
  if (mutation.kind === "schema-extension-add" || mutation.kind === "schema-extension-remove") {
    return completeExtension(mutation, previous, available);
  }
  if (mutation.kind === "schema-template-node-add" || mutation.kind === "schema-template-node-remove") {
    return completeTemplateNodeRelation(mutation, previous, available);
  }
  return completeTemplateField(mutation, previous, available);
}

export function completeSchemaFieldConfigurationEvidence(
  mutation: Extract<Mutation, { kind: "schema-field-configure" }>,
  available: ScopedProjection,
): Extract<Mutation, { kind: "schema-field-configure" }> {
  assertDefinition(available, mutation.schemaId, "Schema", SCHEMA_NODE_TYPE, false);
  assertDefinition(available, mutation.fieldDefinitionId, "Field", FIELD_DEFINITION_NODE_TYPE, false);
  assertNode(available, mutation.fieldNodeId, "Template Field");
  const field = available.templateFields[mutation.schemaId]?.find(
    (candidate) => candidate.fieldNodeId === mutation.fieldNodeId,
  );
  if (!field || field.fieldDefinitionId !== mutation.fieldDefinitionId) {
    throw new Error("Schema Field is absent from the observed projection");
  }
  return {
    ...mutation,
    previousConfig: field.effectiveConfig,
    observedConfigFactIds: field.configCandidates.flatMap((candidate) => candidate.contributionIds),
  };
}

function completeApplication(
  mutation: Extract<Mutation, { kind: "schema-apply" | "schema-remove" }>,
  previous: ScopedProjection,
  available: ScopedProjection,
): Extract<Mutation, { kind: "schema-apply" | "schema-remove" }> {
  const removing = mutation.kind === "schema-remove";
  assertDefinition(available, mutation.schemaId, "Schema", SCHEMA_NODE_TYPE, removing);
  assertNode(available, mutation.nodeId, "Schema application target");
  if (!removing) {
    assertRelationAnchor(available.schemaApplications[mutation.nodeId] ?? [], mutation.anchor, "Schema Application");
    return mutation;
  }
  return withPreviousAnchor(
    mutation,
    previous.schemaApplications[mutation.nodeId] ?? [],
    mutation.schemaId,
    "Schema Application",
  );
}

function completeExtension(
  mutation: Extract<Mutation, { kind: "schema-extension-add" | "schema-extension-remove" }>,
  previous: ScopedProjection,
  available: ScopedProjection,
): Extract<Mutation, { kind: "schema-extension-add" | "schema-extension-remove" }> {
  const removing = mutation.kind === "schema-extension-remove";
  assertDefinition(available, mutation.schemaId, "Schema", SCHEMA_NODE_TYPE, removing);
  assertDefinition(available, mutation.baseSchemaId, "Base Schema", SCHEMA_NODE_TYPE, removing);
  if (!removing) {
    assertRelationAnchor(available.schemaExtensions[mutation.schemaId] ?? [], mutation.anchor, "Schema Extension");
    return mutation;
  }
  return withPreviousAnchor(
    mutation,
    previous.schemaExtensions[mutation.schemaId] ?? [],
    mutation.baseSchemaId,
    "Schema Extension",
  );
}

function completeTemplateField(
  mutation: Extract<Mutation, { kind: "schema-field-add" | "schema-field-remove" }>,
  previous: ScopedProjection,
  available: ScopedProjection,
): Extract<Mutation, { kind: "schema-field-add" | "schema-field-remove" }> {
  const removing = mutation.kind === "schema-field-remove";
  assertDefinition(available, mutation.schemaId, "Schema", SCHEMA_NODE_TYPE, removing);
  assertDefinition(available, mutation.fieldDefinitionId, "Field", FIELD_DEFINITION_NODE_TYPE, removing);
  if (!removing) {
    assertTemplateFieldAddition(mutation, available);
    return mutation;
  }
  const field = previous.templateFields[mutation.schemaId]?.find(
    (candidate) => candidate.fieldNodeId === mutation.fieldNodeId,
  );
  if (
    field?.fieldDefinitionId !== mutation.fieldDefinitionId ||
    field.fieldOccurrenceId !== mutation.fieldOccurrenceId
  ) {
    throw new Error("Template Field binding is absent from the observed projection");
  }
  return withPreviousAnchor(
    mutation,
    previous.children[mutation.schemaId] ?? [],
    mutation.fieldOccurrenceId,
    "Template Field Occurrence",
  );
}

function assertTemplateFieldAddition(
  mutation: Extract<Mutation, { kind: "schema-field-add" }>,
  available: ScopedProjection,
): void {
  const existing = available.templateFields[mutation.schemaId]?.find(
    (field) => field.fieldNodeId === mutation.fieldNodeId,
  );
  const occurrence = available.occurrences[mutation.fieldOccurrenceId];
  const matchingCreation =
    available.nodes[mutation.fieldNodeId] !== undefined &&
    occurrence?.nodeId === mutation.fieldNodeId &&
    occurrence.parentNodeId === mutation.schemaId;
  if (
    (available.nodes[mutation.fieldNodeId] || available.occurrences[mutation.fieldOccurrenceId]) &&
    !matchingCreation &&
    (existing?.fieldDefinitionId !== mutation.fieldDefinitionId ||
      existing.fieldOccurrenceId !== mutation.fieldOccurrenceId)
  ) {
    throw new Error("Template Field Node or Occurrence identity already exists");
  }
  if (
    (available.templateFields[mutation.schemaId] ?? []).some(
      (field) => field.fieldNodeId !== mutation.fieldNodeId && field.fieldDefinitionId === mutation.fieldDefinitionId,
    )
  ) {
    throw new Error("Schema already contains the Template Field or Field Definition");
  }
  assertRelationAnchor(available.children[mutation.schemaId] ?? [], mutation.anchor, "Template Field Occurrence");
}

function completeTemplateNodeRelation(
  mutation: Extract<Mutation, { kind: "schema-template-node-add" | "schema-template-node-remove" }>,
  previous: ScopedProjection,
  available: ScopedProjection,
): Extract<Mutation, { kind: "schema-template-node-add" | "schema-template-node-remove" }> {
  const removing = mutation.kind === "schema-template-node-remove";
  assertDefinition(available, mutation.schemaId, "Schema", SCHEMA_NODE_TYPE, removing);
  if (!removing) {
    assertTemplateNodeAddition(mutation, available);
    return mutation;
  }
  const occurrence = previous.occurrences[mutation.templateOccurrenceId];
  if (occurrence?.nodeId !== mutation.templateNodeId || occurrence.parentNodeId !== mutation.schemaId) {
    throw new Error("Schema Template Node Occurrence is absent from the observed projection");
  }
  return withPreviousAnchor(
    mutation,
    previous.children[mutation.schemaId] ?? [],
    mutation.templateOccurrenceId,
    "Schema Template Node Occurrence",
  );
}

function assertTemplateNodeAddition(
  mutation: Extract<Mutation, { kind: "schema-template-node-add" }>,
  available: ScopedProjection,
): void {
  assertNode(available, mutation.templateNodeId, "Template");
  const occurrence = available.occurrences[mutation.templateOccurrenceId];
  if (occurrence && (occurrence.nodeId !== mutation.templateNodeId || occurrence.parentNodeId !== mutation.schemaId)) {
    throw new Error("Template Node Occurrence identity already exists");
  }
  const existing = templateOccurrenceFor(available, mutation.schemaId, mutation.templateNodeId);
  if (existing && existing !== mutation.templateOccurrenceId) {
    throw new Error("Schema already contains the Template Node");
  }
  assertRelationAnchor(available.children[mutation.schemaId] ?? [], mutation.anchor, "Schema Template Node Occurrence");
}

function withPreviousAnchor<MutationType extends SchemaMutation>(
  mutation: MutationType,
  identities: readonly string[],
  identity: string,
  label: string,
): MutationType {
  const index = identities.indexOf(identity);
  if (index < 0) {
    throw new Error(`${label} is absent from the observed projection`);
  }
  return { ...mutation, previousAnchor: sequenceAnchorAt(identities, index) };
}

function assertRelationAnchor(identities: readonly string[], anchor: SequenceAnchor, label: string): void {
  if ([anchor.after, anchor.before].some((id) => id !== null && !identities.includes(id))) {
    throw new Error(`${label} anchor is absent from the observed projection`);
  }
}

function assertDefinition(
  projection: ScopedProjection,
  definitionId: string,
  label: string,
  nodeType: DefinitionNodeType,
  allowDeleted: boolean,
): void {
  const state = definitionNodeState(projection, definitionId, nodeType);
  if (state === "active" || (allowDeleted && state === "deleted")) {
    return;
  }
  throw new Error(`${label} type is absent from the observed projection`);
}

function assertNode(projection: ScopedProjection, nodeId: string, label: string): void {
  if (!projection.nodes[nodeId]) {
    throw new Error(`${label} Node is absent from the observed projection`);
  }
}

function templateOccurrenceFor(
  projection: Pick<ScopedProjection, "occurrences">,
  schemaId: string,
  templateNodeId: string,
): string | null {
  return (
    Object.values(projection.occurrences)
      .filter((occurrence) => occurrence.parentNodeId === schemaId && occurrence.nodeId === templateNodeId)
      .map((occurrence) => occurrence.occurrenceId)
      .sort()[0] ?? null
  );
}
