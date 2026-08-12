import { type Mutation, type SequenceAnchor } from "../../domain/fact/index.js";
import type { ProjectionGeneration } from "../../domain/reconcile/index.js";
import { projectEffectiveFields } from "../../domain/reconcile/schema-field-config.js";
import type { MutableProjection } from "./planning-projection-mutation.js";
import { insertionIndex } from "./planning-projection-sequence.js";
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
    projection.schemaFieldItems,
    projection.schemaExtensions,
    projection.materializedFields,
  );
}

function markMutationDefinitions(projection: MutableProjection, mutation: Mutation): void {
  const mark = (definitionId: string, kind: "schema" | "field") => {
    const current = projection.definitionStatuses[definitionId];
    projection.definitionStatuses[definitionId] = current
      ? { ...current, kinds: [...new Set([...current.kinds, kind])].sort() }
      : { definitionId, kinds: [kind], state: "active", deletionFactIds: [] };
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
    assertActiveDefinition(available, mutation.schemaId, "Schema");
    assertActiveDefinition(available, mutation.fieldDefinitionId, "Field Definition");
    const item = available.schemaFieldItems[mutation.schemaId]?.find(
      (candidate) => candidate.fieldDefinitionId === mutation.fieldDefinitionId,
    );
    if (!item) {
      throw new Error("Schema Field does not exist");
    }
    return {
      ...mutation,
      previousConfig: item.effectiveConfig,
      observedConfigFactIds: item.configCandidates.flatMap(
        (candidate) => candidate.contributionIds,
      ),
    };
  }
  if (mutation.kind === "schema-extension-add" || mutation.kind === "schema-extension-remove") {
    assertDefinition(
      available,
      mutation.schemaId,
      "Schema",
      mutation.kind === "schema-extension-remove",
    );
    assertDefinition(
      available,
      mutation.baseSchemaId,
      "Base Schema",
      mutation.kind === "schema-extension-remove",
    );
    const bases = available.schemaExtensions[mutation.schemaId] ?? [];
    if (mutation.kind === "schema-extension-add") {
      assertRelationAnchor(bases, mutation.anchor, "Schema Extension");
      return mutation;
    }
    const index = bases.indexOf(mutation.baseSchemaId);
    if (index < 0) {
      throw new Error("Schema Extension does not exist");
    }
    return { ...mutation, previousAnchor: anchorAt(bases, index) };
  }
  if (
    mutation.kind === "schema-template-node-add" ||
    mutation.kind === "schema-template-node-remove"
  ) {
    return mutation;
  }
  if (mutation.kind === "schema-apply" || mutation.kind === "schema-remove") {
    assertDefinition(available, mutation.schemaId, "Schema", mutation.kind === "schema-remove");
    assertNode(available, mutation.nodeId, "Schema application target");
    const applications = available.schemaApplications[mutation.nodeId] ?? [];
    if (mutation.kind === "schema-apply") {
      assertRelationAnchor(applications, mutation.anchor, "Schema Application");
    } else {
      const index = applications.indexOf(mutation.schemaId);
      if (index < 0) {
        throw new Error("Schema Application does not exist");
      }
      return { ...mutation, previousAnchor: anchorAt(applications, index) };
    }
  } else {
    assertDefinition(
      available,
      mutation.schemaId,
      "Schema",
      mutation.kind === "schema-field-remove",
    );
    assertDefinition(
      available,
      mutation.fieldDefinitionId,
      "Field Definition",
      mutation.kind === "schema-field-remove",
    );
    if (mutation.kind === "schema-field-add") {
      assertFieldAnchor(available, mutation.schemaId, mutation.anchor);
    } else {
      const fields = available.schemaFields[mutation.schemaId] ?? [];
      const index = fields.indexOf(mutation.fieldDefinitionId);
      if (index < 0) {
        throw new Error("Schema Field does not exist");
      }
      return { ...mutation, previousAnchor: anchorAt(fields, index) };
    }
  }
  return mutation;
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
  if (allowDeleted && projection.definitionStatuses[definitionId]?.state === "deleted") {
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

function assertFieldAnchor(
  projection: ProjectionGeneration["review"],
  schemaId: string,
  anchor: SequenceAnchor,
): void {
  const fields = projection.schemaFields[schemaId] ?? [];
  assertRelationAnchor(fields, anchor, "Schema Field");
}

function assertRelationAnchor(
  identities: readonly string[],
  anchor: SequenceAnchor,
  label: string,
): void {
  if ([anchor.after, anchor.before].some((id) => id !== null && !identities.includes(id))) {
    throw new Error(`${label} anchor does not exist`);
  }
}

function anchorAt(identities: readonly string[], index: number): SequenceAnchor {
  return {
    after: identities[index - 1] ?? null,
    before: identities[index + 1] ?? null,
    affinity: index === 0 ? "before" : "after",
    fallback: index === 0 ? "start" : "end",
  };
}

function remove(values: string[], value: string): void {
  const index = values.indexOf(value);
  if (index >= 0) {
    values.splice(index, 1);
  }
}
