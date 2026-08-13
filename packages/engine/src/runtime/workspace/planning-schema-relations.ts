import { type Mutation } from "../../domain/fact/index.js";
import type { ProjectionGeneration } from "../../domain/reconcile/index.js";
import { projectEffectiveFields } from "../../domain/reconcile/schema-field-config.js";
import type { MutableProjection } from "./planning-projection-mutation.js";
import { anchorAt, assertRelationAnchor, insertionIndex } from "./planning-projection-sequence.js";
import { applyFieldPlanningMutation } from "./planning-field-relations.js";
import {
  applyTemplatePlanningMutation,
  prepareTemplateNodeRelation,
  refreshPlanningTemplateNodeInstances,
} from "./planning-template-nodes.js";

export function applySchemaPlanningMutation(
  projection: MutableProjection,
  mutation: Mutation,
  factId: string,
): boolean {
  markMutationDefinitions(projection, mutation);
  if (applyTemplatePlanningMutation(projection, mutation, factId)) {
    refreshEffectiveFields(projection);
    return true;
  }
  let refreshTemplates = false;
  if (mutation.kind === "schema-apply") {
    refreshTemplates = true;
    const applications = (projection.schemaApplications[mutation.nodeId] ??= []);
    remove(applications, mutation.schemaId);
    applications.splice(
      insertionIndex(
        applications.map((id) => ({ id })),
        mutation.anchor,
      ),
      0,
      mutation.schemaId,
    );
  } else if (mutation.kind === "schema-remove") {
    refreshTemplates = true;
    remove(projection.schemaApplications[mutation.nodeId] ?? [], mutation.schemaId);
  } else if (!applyFieldPlanningMutation(projection, mutation, factId)) {
    if (mutation.kind !== "schema-extension-add" && mutation.kind !== "schema-extension-remove") {
      return false;
    }
    refreshTemplates = true;
    if (mutation.kind === "schema-extension-add") {
      const bases = (projection.schemaExtensions[mutation.schemaId] ??= []);
      remove(bases, mutation.baseSchemaId);
      bases.splice(
        insertionIndex(
          bases.map((id) => ({ id })),
          mutation.anchor,
        ),
        0,
        mutation.baseSchemaId,
      );
    } else {
      remove(projection.schemaExtensions[mutation.schemaId] ?? [], mutation.baseSchemaId);
    }
  }
  refreshEffectiveFields(projection);
  if (refreshTemplates) {
    refreshPlanningTemplateNodeInstances(projection);
  }
  return true;
}

function refreshEffectiveFields(projection: MutableProjection): void {
  projection.effectiveFields = projectEffectiveFields(
    projection.schemaApplications,
    projection.templateFields,
    projection.schemaExtensions,
    projection.materializedFields,
  );
}

function markMutationDefinitions(projection: MutableProjection, mutation: Mutation): void {
  const mark = (definitionId: string, kind: "schema" | "field") => {
    const current = projection.nodeStatuses[definitionId];
    projection.nodeStatuses[definitionId] = current
      ? { ...current, roles: [...new Set([...current.roles, kind])].sort() }
      : { nodeId: definitionId, roles: [kind], state: "active", deletionFactIds: [] };
  };
  if (!mutation.kind.startsWith("schema-") && mutation.kind !== "field-materialize") {
    return;
  }
  if ("schemaId" in mutation) {
    mark(mutation.schemaId, "schema");
  }
  if ("baseSchemaId" in mutation) {
    mark(mutation.baseSchemaId, "schema");
  }
  if ("fieldDefinitionId" in mutation) {
    mark(mutation.fieldDefinitionId, "field");
  }
}

export function prepareSchemaMutation(
  mutation: Extract<Mutation, { kind: `schema-${string}` }>,
  available: ProjectionGeneration["review"],
): Mutation {
  const templateNodeRelation = prepareTemplateNodeRelation(mutation, available);
  if (templateNodeRelation) {
    return templateNodeRelation;
  }
  if (mutation.kind === "schema-field-configure") {
    return prepareFieldConfiguration(mutation, available);
  }
  if (mutation.kind === "schema-extension-add" || mutation.kind === "schema-extension-remove") {
    return prepareExtension(mutation, available);
  }
  if (
    mutation.kind === "schema-template-node-add" ||
    mutation.kind === "schema-template-node-remove"
  ) {
    return mutation;
  }
  if (mutation.kind === "schema-apply" || mutation.kind === "schema-remove") {
    return prepareApplication(mutation, available);
  }
  return prepareTemplateField(mutation, available);
}

function prepareFieldConfiguration(
  mutation: Extract<Mutation, { kind: "schema-field-configure" }>,
  available: ProjectionGeneration["review"],
): Mutation {
  assertActiveDefinition(available, mutation.schemaId, "Schema");
  assertActiveDefinition(available, mutation.fieldDefinitionId, "Field Definition");
  assertNode(available, mutation.fieldNodeId, "Template Field");
  const item = available.templateFields[mutation.schemaId]?.find(
    (candidate) => candidate.fieldNodeId === mutation.fieldNodeId,
  );
  if (!item) {
    throw new Error("Schema Field does not exist");
  }
  return {
    ...mutation,
    previousConfig: item.effectiveConfig,
    observedConfigFactIds: item.configCandidates.flatMap((candidate) => candidate.contributionIds),
  };
}

function prepareExtension(
  mutation: Extract<Mutation, { kind: "schema-extension-add" | "schema-extension-remove" }>,
  available: ProjectionGeneration["review"],
): Mutation {
  const removing = mutation.kind === "schema-extension-remove";
  assertDefinition(available, mutation.schemaId, "Schema", removing);
  assertDefinition(available, mutation.baseSchemaId, "Base Schema", removing);
  const bases = available.schemaExtensions[mutation.schemaId] ?? [];
  if (!removing) {
    assertRelationAnchor(bases, mutation.anchor, "Schema Extension");
    return mutation;
  }
  const index = bases.indexOf(mutation.baseSchemaId);
  if (index < 0) {
    throw new Error("Schema Extension does not exist");
  }
  return { ...mutation, previousAnchor: anchorAt(bases, index) };
}

function prepareApplication(
  mutation: Extract<Mutation, { kind: "schema-apply" | "schema-remove" }>,
  available: ProjectionGeneration["review"],
): Mutation {
  const removing = mutation.kind === "schema-remove";
  assertDefinition(available, mutation.schemaId, "Schema", removing);
  assertNode(available, mutation.nodeId, "Schema application target");
  const applications = available.schemaApplications[mutation.nodeId] ?? [];
  if (!removing) {
    assertRelationAnchor(applications, mutation.anchor, "Schema Application");
    return mutation;
  }
  const index = applications.indexOf(mutation.schemaId);
  if (index < 0) {
    throw new Error("Schema Application does not exist");
  }
  return { ...mutation, previousAnchor: anchorAt(applications, index) };
}

function prepareTemplateField(
  mutation: Extract<Mutation, { kind: "schema-field-add" | "schema-field-remove" }>,
  available: ProjectionGeneration["review"],
): Mutation {
  const removing = mutation.kind === "schema-field-remove";
  assertDefinition(available, mutation.schemaId, "Schema", removing);
  assertDefinition(available, mutation.fieldDefinitionId, "Field Definition", removing);
  if (!removing) {
    prepareTemplateFieldAddition(mutation, available);
    return mutation;
  }
  const field = available.templateFields[mutation.schemaId]?.find(
    (candidate) => candidate.fieldNodeId === mutation.fieldNodeId,
  );
  if (
    field?.fieldDefinitionId !== mutation.fieldDefinitionId ||
    field.fieldOccurrenceId !== mutation.fieldOccurrenceId
  ) {
    throw new Error("Schema Field does not exist");
  }
  const children = available.children[mutation.schemaId] ?? [];
  return {
    ...mutation,
    previousAnchor: anchorAt(children, children.indexOf(mutation.fieldOccurrenceId)),
  };
}

function prepareTemplateFieldAddition(
  mutation: Extract<Mutation, { kind: "schema-field-add" }>,
  available: ProjectionGeneration["review"],
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
      (field) =>
        field.fieldNodeId !== mutation.fieldNodeId &&
        field.fieldDefinitionId === mutation.fieldDefinitionId,
    )
  ) {
    throw new Error("Schema already contains the Template Field or Field Definition");
  }
  assertRelationAnchor(
    available.children[mutation.schemaId] ?? [],
    mutation.anchor,
    "Template Field Occurrence",
  );
}

function assertDefinition(
  projection: ProjectionGeneration["review"],
  definitionId: string,
  label: string,
  allowDeleted: boolean,
): void {
  if (projection.nodes[definitionId]) {
    return;
  }
  if (allowDeleted && projection.nodeStatuses[definitionId]?.state === "deleted") {
    return;
  }
  throw new Error(`${label} Definition is deleted or does not exist: ${definitionId}`);
}

function assertActiveDefinition(
  projection: ProjectionGeneration["review"],
  definitionId: string,
  label: string,
): void {
  assertDefinition(projection, definitionId, label, false);
}

function assertNode(
  projection: ProjectionGeneration["review"],
  nodeId: string,
  label: string,
): void {
  if (!projection.nodes[nodeId]) {
    throw new Error(`${label} Node does not exist: ${nodeId}`);
  }
}

function remove(values: string[], value: string): void {
  const index = values.indexOf(value);
  if (index >= 0) {
    values.splice(index, 1);
  }
}
