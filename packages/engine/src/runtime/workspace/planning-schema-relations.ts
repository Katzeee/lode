import {
  DEFAULT_FIELD_TEMPLATE_CONFIG,
  type Mutation,
  type SequenceAnchor,
} from "../../domain/fact/index.js";
import type { ProjectionGeneration } from "../../domain/reconcile/index.js";
import {
  fieldTemplateItemId,
  projectEffectiveFields,
} from "../../domain/reconcile/schema-field-config.js";
import type { MutableProjection } from "./planning-projection-mutation.js";
import { insertionIndex } from "./planning-projection-sequence.js";

export function applySchemaPlanningMutation(
  projection: MutableProjection,
  mutation: Mutation,
  factId: string,
): boolean {
  if (mutation.kind === "schema-apply") {
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
    remove(projection.schemaApplications[mutation.nodeId] ?? [], mutation.schemaId);
  } else if (mutation.kind === "schema-field-add") {
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
  } else if (mutation.kind === "schema-field-remove") {
    remove(projection.schemaFields[mutation.schemaId] ?? [], mutation.fieldDefinitionId);
    projection.schemaFieldItems[mutation.schemaId] = (
      projection.schemaFieldItems[mutation.schemaId] ?? []
    ).filter((item) => item.fieldDefinitionId !== mutation.fieldDefinitionId);
  } else if (mutation.kind === "schema-field-configure") {
    const items = projection.schemaFieldItems[mutation.schemaId] ?? [];
    const index = items.findIndex((item) => item.fieldDefinitionId === mutation.fieldDefinitionId);
    if (index >= 0) {
      const item = items[index];
      if (item) {
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
    }
  } else if (mutation.kind === "schema-extension-add") {
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
  } else if (mutation.kind === "schema-extension-remove") {
    remove(projection.schemaExtensions[mutation.schemaId] ?? [], mutation.baseSchemaId);
  } else if (mutation.kind === "field-materialize") {
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
  } else if (mutation.kind === "field-initialize") {
    // Initialization is projected from its immutable Fact after the command commits.
  } else {
    return false;
  }
  projection.effectiveFields = projectEffectiveFields(
    projection.schemaApplications,
    projection.schemaFieldItems,
    projection.schemaExtensions,
    projection.materializedFields,
  );
  return true;
}

export function prepareSchemaMutation(
  mutation: Extract<Mutation, { kind: `schema-${string}` }>,
  available: ProjectionGeneration["review"],
): Mutation {
  assertNode(available, mutation.schemaId, "Schema");
  if (mutation.kind === "schema-field-configure") {
    assertNode(available, mutation.fieldDefinitionId, "Field Definition");
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
    assertNode(available, mutation.baseSchemaId, "Base Schema");
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
  if (mutation.kind === "schema-apply" || mutation.kind === "schema-remove") {
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
    assertNode(available, mutation.fieldDefinitionId, "Field Definition");
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
