import {
  initializedFieldNodeId,
  initializedFieldOccurrenceId,
  initializedValueNodeId,
  initializedValueOccurrenceId,
  type FieldValueSeed,
  type InitializedFieldValue,
  type Mutation,
} from "../../domain/fact/index.js";
import type { ProjectionGeneration } from "../../domain/reconcile/index.js";
import { projectEffectiveFields } from "../../domain/reconcile/schema-field-config.js";

export function schemaApplicationInitializations(
  mutation: Extract<Mutation, { kind: "schema-apply" }>,
  projection: ProjectionGeneration["review"],
): readonly Mutation[] {
  if ((projection.schemaApplications[mutation.nodeId] ?? []).includes(mutation.schemaId)) {
    return [];
  }
  const applications = {
    ...projection.schemaApplications,
    [mutation.nodeId]: [
      ...(projection.schemaApplications[mutation.nodeId] ?? []),
      mutation.schemaId,
    ],
  };
  const fields =
    projectEffectiveFields(
      applications,
      projection.templateFields,
      projection.schemaExtensions,
      projection.materializedFields,
    )[mutation.nodeId] ?? [];
  return fields.flatMap((field): readonly Mutation[] => {
    if (
      field.materializedFieldNodeId !== null ||
      field.visibility === "optional" ||
      field.effectiveConfig === null
    ) {
      return [];
    }
    const initialized = initializationValues(field.effectiveConfig, mutation.nodeId, projection);
    const fieldNodeId = initializedFieldNodeId(mutation.nodeId, field.fieldDefinitionId);
    const fieldOccurrenceId = initializedFieldOccurrenceId(
      mutation.nodeId,
      field.fieldDefinitionId,
    );
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

export function prepareFieldInitialization(
  mutation: Extract<Mutation, { kind: "field-initialize" }>,
  available: ProjectionGeneration["review"],
): Mutation {
  const field = available.effectiveFields[mutation.ownerNodeId]?.find(
    (candidate) => candidate.fieldDefinitionId === mutation.fieldDefinitionId,
  );
  if (!field) {
    throw new Error("Field initialization has no effective Schema source");
  }
  if (field.materializedFieldNodeId !== null) {
    throw new Error("Field is already materialized");
  }
  return {
    ...mutation,
    observedInitializationFactIds: field.initializationCandidates.map(
      (candidate) => candidate.initializationId,
    ),
  };
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
  config: NonNullable<
    ProjectionGeneration["review"]["effectiveFields"][string][number]["effectiveConfig"]
  >,
  nodeId: string,
  projection: ProjectionGeneration["review"],
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
