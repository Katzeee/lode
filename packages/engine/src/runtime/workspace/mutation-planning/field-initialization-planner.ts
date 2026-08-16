import {
  initializedFieldNodeId,
  initializedFieldOccurrenceId,
  initializedValueNodeId,
  initializedValueOccurrenceId,
  type FieldValueSeed,
  type InitializedFieldValue,
  type Mutation,
} from "../../../domain/fact/index.js";
import type { ScopedProjection } from "../../../domain/reconcile/index.js";

export function fieldInitializationFollowUps(
  mutation: Mutation,
  before: ScopedProjection,
  after: ScopedProjection,
): readonly Mutation[] {
  if (mutation.kind !== "supertag-apply") {
    return [];
  }
  const alreadyApplied = (before.supertagApplications[mutation.nodeId] ?? []).includes(mutation.supertagId);
  return alreadyApplied ? [] : supertagApplicationInitializations(mutation, after);
}

export function supertagApplicationInitializations(
  mutation: Extract<Mutation, { kind: "supertag-apply" }>,
  projection: ScopedProjection,
): readonly Mutation[] {
  if (!(projection.supertagApplications[mutation.nodeId] ?? []).includes(mutation.supertagId)) {
    return [];
  }
  const fields = projection.effectiveFields[mutation.nodeId] ?? [];
  return fields.flatMap((field): readonly Mutation[] => {
    if (field.materializedFieldNodeId !== null || field.visibility === "optional" || field.effectiveConfig === null) {
      return [];
    }
    const initialized = initializationValues(
      mutation.nodeId,
      field.fieldDefinitionId,
      field.effectiveConfig,
      projection,
    );
    const fieldNodeId = initializedFieldNodeId(mutation.nodeId, field.fieldDefinitionId);
    const fieldOccurrenceId = initializedFieldOccurrenceId(mutation.nodeId, field.fieldDefinitionId);
    return initialized === null
      ? []
      : [
          {
            kind: "field-initialize",
            ownerNodeId: mutation.nodeId,
            supertagId: mutation.supertagId,
            fieldDefinitionId: field.fieldDefinitionId,
            fieldNodeId,
            fieldOccurrenceId,
            source: initialized.source,
            values: initializeValues(fieldNodeId, fieldOccurrenceId, initialized.values),
          },
        ];
  });
}

function initializeValues(
  fieldNodeId: string,
  fieldOccurrenceId: string,
  seeds: readonly FieldValueSeed[],
): readonly InitializedFieldValue[] {
  return seeds.map((seed, index) => ({
    ...seed,
    nodeId: seed.kind === "reference" ? seed.nodeId : initializedValueNodeId(fieldNodeId, index),
    occurrenceId: initializedValueOccurrenceId(fieldOccurrenceId, index),
  }));
}

function initializationValues(
  ownerNodeId: string,
  fieldDefinitionId: string,
  config: NonNullable<ScopedProjection["effectiveFields"][string][number]["effectiveConfig"]>,
  projection: ScopedProjection,
) {
  if (config.staticDefault !== null) {
    return { source: "static-default" as const, values: config.staticDefault };
  }
  const expressions = projection.fieldDefinitionConfigurations[fieldDefinitionId]?.filter(
    (configuration) => configuration.kind === "initialization-expression",
  );
  if (expressions?.length !== 1) {
    return null;
  }
  const expression = expressions[0];
  if (
    expression?.kind !== "initialization-expression" ||
    expression.expression.kind !== "ancestor-field-values" ||
    expression.expression.sourceFieldDefinitionId !== fieldDefinitionId
  ) {
    return null;
  }
  const values = ancestorFieldValues(ownerNodeId, fieldDefinitionId, projection);
  if (values === null) {
    return null;
  }
  return { source: "auto-initialize" as const, values };
}

function ancestorFieldValues(
  ownerNodeId: string,
  fieldDefinitionId: string,
  projection: ScopedProjection,
): readonly FieldValueSeed[] | null {
  const matches: FieldValueSeed[][] = [];
  const visited = new Set<string>();
  let ancestorId = projection.nodeOwners[ownerNodeId] ?? null;
  while (ancestorId !== null && !visited.has(ancestorId)) {
    visited.add(ancestorId);
    const fields = (projection.materializedFields[ancestorId] ?? []).filter(
      (field) => field.fieldDefinitionId === fieldDefinitionId,
    );
    for (const field of fields) {
      const values = field.valueOccurrenceIds.flatMap((occurrenceId): readonly FieldValueSeed[] => {
        const occurrence = projection.occurrences[occurrenceId];
        if (!occurrence) {
          return [];
        }
        if (projection.nodeOwners[occurrence.nodeId] !== field.fieldNodeId) {
          return [{ kind: "reference", nodeId: occurrence.nodeId }];
        }
        const node = projection.nodes[occurrence.nodeId];
        return node
          ? [
              {
                kind: "text",
                value: node.content.flatMap((item) => (item.kind === "text" ? [item.value] : [])).join(""),
              },
            ]
          : [];
      });
      if (values.length > 0) {
        matches.push(values);
      }
    }
    ancestorId = projection.nodeOwners[ancestorId] ?? null;
  }
  return matches.length === 1 ? (matches[0] ?? null) : null;
}
