import { DEFAULT_FIELD_TEMPLATE_CONFIG, type Mutation } from "../../domain/fact/index.js";
import { fieldTemplateItemId } from "../../domain/reconcile/schema-field-config.js";
import type { MutableProjection } from "./planning-projection-mutation.js";
import { insertionIndex } from "./planning-projection-sequence.js";

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
  } else if (mutation.kind !== "field-initialize") {
    return false;
  }
  return true;
}

function addField(
  projection: MutableProjection,
  mutation: Extract<Mutation, { kind: "schema-field-add" }>,
): void {
  const fields = (projection.schemaFields[mutation.schemaId] ??= []);
  remove(fields, mutation.fieldDefinitionId);
  fields.splice(
    insertionIndex(
      fields.map((id) => ({ id })),
      mutation.anchor,
    ),
    0,
    mutation.fieldDefinitionId,
  );
  const items = (projection.schemaFieldItems[mutation.schemaId] ??= []);
  if (!items.some((item) => item.fieldDefinitionId === mutation.fieldDefinitionId)) {
    items.splice(fields.indexOf(mutation.fieldDefinitionId), 0, {
      templateItemId: fieldTemplateItemId(mutation.schemaId, mutation.fieldDefinitionId),
      schemaId: mutation.schemaId,
      fieldDefinitionId: mutation.fieldDefinitionId,
      configCandidates: [],
      effectiveConfig: DEFAULT_FIELD_TEMPLATE_CONFIG,
    });
  }
}

function removeField(
  projection: MutableProjection,
  mutation: Extract<Mutation, { kind: "schema-field-remove" }>,
): void {
  remove(projection.schemaFields[mutation.schemaId] ?? [], mutation.fieldDefinitionId);
  projection.schemaFieldItems[mutation.schemaId] = (
    projection.schemaFieldItems[mutation.schemaId] ?? []
  ).filter((item) => item.fieldDefinitionId !== mutation.fieldDefinitionId);
}

function configureField(
  projection: MutableProjection,
  mutation: Extract<Mutation, { kind: "schema-field-configure" }>,
  factId: string,
): void {
  const items = projection.schemaFieldItems[mutation.schemaId] ?? [];
  const index = items.findIndex((item) => item.fieldDefinitionId === mutation.fieldDefinitionId);
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
        sourceTemplateItemIds: [item.templateItemId],
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
      valueOccurrenceIds: projection.children[mutation.fieldOccurrenceId] ?? [],
    });
  }
}

function remove(values: string[], value: string): void {
  const index = values.indexOf(value);
  if (index >= 0) {
    values.splice(index, 1);
  }
}
