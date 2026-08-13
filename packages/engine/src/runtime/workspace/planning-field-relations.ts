import { DEFAULT_FIELD_TEMPLATE_CONFIG, type Mutation } from "../../domain/fact/index.js";
import type { MutableProjection } from "./planning-projection-mutation.js";

export function applyFieldPlanningMutation(
  projection: MutableProjection,
  mutation: Mutation,
  factId: string,
): boolean {
  if (mutation.kind === "schema-field-add") {
    addField(projection, mutation);
  } else if (mutation.kind === "schema-field-remove") {
    removeField(projection, mutation);
  } else if (mutation.kind === "schema-field-configure") {
    configureField(projection, mutation, factId);
  } else if (mutation.kind === "field-materialize") {
    materializeField(projection, mutation);
  } else if (mutation.kind === "field-initialize") {
    initializeField(projection, mutation);
  } else {
    return false;
  }
  return true;
}

function addField(
  projection: MutableProjection,
  mutation: Extract<Mutation, { kind: "schema-field-add" }>,
): void {
  const fields = (projection.schemaFields[mutation.schemaId] ??= []);
  const items = (projection.templateFields[mutation.schemaId] ??= []);
  if (!items.some((item) => item.fieldNodeId === mutation.fieldNodeId)) {
    items.push({
      fieldNodeId: mutation.fieldNodeId,
      fieldOccurrenceId: mutation.fieldOccurrenceId,
      schemaId: mutation.schemaId,
      fieldDefinitionId: mutation.fieldDefinitionId,
      configCandidates: [],
      effectiveConfig: DEFAULT_FIELD_TEMPLATE_CONFIG,
    });
    const occurrenceOrder = projection.children[mutation.schemaId] ?? [];
    items.sort(
      (left, right) =>
        occurrenceOrder.indexOf(left.fieldOccurrenceId) -
        occurrenceOrder.indexOf(right.fieldOccurrenceId),
    );
    fields.splice(0, fields.length, ...items.map((item) => item.fieldDefinitionId));
  }
}

function initializeField(
  projection: MutableProjection,
  mutation: Extract<Mutation, { kind: "field-initialize" }>,
): void {
  const valueOccurrenceIds = mutation.values.flatMap((value) =>
    projection.occurrences[value.occurrenceId]?.nodeId === value.nodeId ? [value.occurrenceId] : [],
  );
  const fields = (projection.materializedFields[mutation.ownerNodeId] ??= []);
  fields.push({
    ownerNodeId: mutation.ownerNodeId,
    fieldDefinitionId: mutation.fieldDefinitionId,
    fieldNodeId: mutation.fieldNodeId,
    fieldOccurrenceId: mutation.fieldOccurrenceId,
    valueOccurrenceIds,
  });
  const effective = projection.effectiveFields[mutation.ownerNodeId] ?? [];
  projection.effectiveFields = {
    ...projection.effectiveFields,
    [mutation.ownerNodeId]: effective.map((field) =>
      field.fieldDefinitionId === mutation.fieldDefinitionId
        ? {
            ...field,
            materializedFieldNodeId: mutation.fieldNodeId,
            initializedValues: mutation.values.map((value) =>
              value.kind === "text"
                ? { kind: "text", value: value.value }
                : { kind: "reference", nodeId: value.nodeId },
            ),
          }
        : field,
    ),
  };
}

function removeField(
  projection: MutableProjection,
  mutation: Extract<Mutation, { kind: "schema-field-remove" }>,
): void {
  projection.templateFields[mutation.schemaId] = (
    projection.templateFields[mutation.schemaId] ?? []
  ).filter((item) => item.fieldNodeId !== mutation.fieldNodeId);
  projection.schemaFields[mutation.schemaId] = (
    projection.templateFields[mutation.schemaId] ?? []
  ).map((item) => item.fieldDefinitionId);
}

function configureField(
  projection: MutableProjection,
  mutation: Extract<Mutation, { kind: "schema-field-configure" }>,
  factId: string,
): void {
  const items = projection.templateFields[mutation.schemaId] ?? [];
  const index = items.findIndex((item) => item.fieldNodeId === mutation.fieldNodeId);
  const item = items[index];
  if (!item) {
    return;
  }
  items[index] = {
    ...item,
    configCandidates: [
      {
        config: mutation.config,
        sourceSchemaIds: [mutation.schemaId],
        sourceFieldNodeIds: [item.fieldNodeId],
        contributionIds: [factId],
      },
    ],
    effectiveConfig: mutation.config,
  };
}

function materializeField(
  projection: MutableProjection,
  mutation: Extract<Mutation, { kind: "field-materialize" }>,
): void {
  const fields = (projection.materializedFields[mutation.ownerNodeId] ??= []);
  if (!fields.some((field) => field.fieldDefinitionId === mutation.fieldDefinitionId)) {
    fields.push({
      ownerNodeId: mutation.ownerNodeId,
      fieldDefinitionId: mutation.fieldDefinitionId,
      fieldNodeId: mutation.fieldNodeId,
      fieldOccurrenceId: mutation.fieldOccurrenceId,
      valueOccurrenceIds: projection.children[mutation.fieldNodeId] ?? [],
    });
  }
}
