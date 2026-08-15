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
  if (mutation.kind !== "schema-apply") {
    return [];
  }
  const alreadyApplied = (before.schemaApplications[mutation.nodeId] ?? []).includes(mutation.schemaId);
  return alreadyApplied ? [] : schemaApplicationInitializations(mutation, after);
}

export function schemaApplicationInitializations(
  mutation: Extract<Mutation, { kind: "schema-apply" }>,
  projection: ScopedProjection,
): readonly Mutation[] {
  if (!(projection.schemaApplications[mutation.nodeId] ?? []).includes(mutation.schemaId)) {
    return [];
  }
  const fields = projection.effectiveFields[mutation.nodeId] ?? [];
  return fields.flatMap((field): readonly Mutation[] => {
    if (field.materializedFieldNodeId !== null || field.visibility === "optional" || field.effectiveConfig === null) {
      return [];
    }
    const initialized = initializationValues(field.effectiveConfig, mutation.nodeId, projection);
    const fieldNodeId = initializedFieldNodeId(mutation.nodeId, field.fieldDefinitionId);
    const fieldOccurrenceId = initializedFieldOccurrenceId(mutation.nodeId, field.fieldDefinitionId);
    return initialized === null
      ? []
      : [
          {
            kind: "field-initialize",
            ownerNodeId: mutation.nodeId,
            schemaId: mutation.schemaId,
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
  config: NonNullable<ScopedProjection["effectiveFields"][string][number]["effectiveConfig"]>,
  nodeId: string,
  projection: ScopedProjection,
) {
  if (config.staticDefault !== null) {
    return { source: "static-default" as const, values: config.staticDefault };
  }
  if (config.initializer?.kind === "literal") {
    return { source: "auto-initialize" as const, values: config.initializer.values };
  }
  if (config.initializer?.kind === "application-node-text") {
    return {
      source: "auto-initialize" as const,
      values: [
        {
          kind: "text" as const,
          value: projection.nodes[nodeId]?.text.map((atom) => atom.value).join("") ?? "",
        },
      ],
    };
  }
  return null;
}
