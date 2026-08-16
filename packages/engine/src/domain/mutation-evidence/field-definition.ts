import {
  canonicalJson,
  type FieldCardinality,
  type FieldDatatype,
  type FieldDefinitionConfigMutation,
  type FieldInitializationExpression,
} from "../fact/index.js";
import type { FieldDefinitionConfiguration, ScopedProjection } from "../reconcile/index.js";
import { assertEvidenceEqual } from "./evidence-validation.js";
import type { MutationEvidenceFamily } from "./policy.js";

const MUTATION_KINDS = [
  "field-datatype-configure",
  "field-cardinality-configure",
  "field-initialization-expression-configure",
] as const satisfies readonly FieldDefinitionConfigMutation["kind"][];

export const fieldDefinitionMutationEvidence = {
  key: "field-definition",
  mutationKinds: MUTATION_KINDS,
  complete(mutation, context) {
    if (hasEvidence(mutation)) {
      return mutation;
    }
    const current = currentConfigurations(mutation, context.projections().available);
    const observedValueFactIds = current.map((item) => item.contributionId);
    if (mutation.kind === "field-datatype-configure") {
      return {
        ...mutation,
        previousDatatype: uniqueValue<FieldDatatype>(current, (item) =>
          item.kind === "datatype" ? item.datatype : undefined,
        ),
        observedValueFactIds,
      };
    }
    if (mutation.kind === "field-cardinality-configure") {
      return {
        ...mutation,
        previousCardinality: uniqueValue<FieldCardinality>(current, (item) =>
          item.kind === "cardinality" ? item.cardinality : undefined,
        ),
        observedValueFactIds,
      };
    }
    return {
      ...mutation,
      previousExpression: uniqueValue<FieldInitializationExpression>(current, (item) =>
        item.kind === "initialization-expression" ? item.expression : undefined,
      ),
      observedValueFactIds,
    };
  },
  validate(mutation, context) {
    const expected = fieldDefinitionMutationEvidence.complete(withoutEvidence(mutation), context);
    const expectedPrevious = previousValue(expected);
    const actualPrevious = previousValue(mutation);
    assertEvidenceEqual(expectedPrevious, actualPrevious, "Field Definition previous configuration");
    if (
      canonicalJson([...(expected.observedValueFactIds ?? [])].sort()) !==
      canonicalJson([...(mutation.observedValueFactIds ?? [])].sort())
    ) {
      throw new Error("Field Definition configuration Fact evidence does not match the observed projection");
    }
  },
} satisfies MutationEvidenceFamily<(typeof MUTATION_KINDS)[number]>;

function currentConfigurations(
  mutation: FieldDefinitionConfigMutation,
  projection: ScopedProjection,
): readonly FieldDefinitionConfiguration[] {
  const kind =
    mutation.kind === "field-datatype-configure"
      ? "datatype"
      : mutation.kind === "field-cardinality-configure"
        ? "cardinality"
        : "initialization-expression";
  return (projection.fieldDefinitionConfigurations[mutation.fieldDefinitionId] ?? []).filter(
    (item) => item.kind === kind && item.configurationNodeId === mutation.configurationNodeId,
  );
}

function uniqueValue<Value>(
  configurations: readonly FieldDefinitionConfiguration[],
  read: (configuration: FieldDefinitionConfiguration) => Value | undefined,
): Value | null {
  if (configurations.length === 0) {
    return null;
  }
  const values = configurations.map(read);
  const first = values[0];
  if (first === undefined || values.some((value) => canonicalJson(value) !== canonicalJson(first))) {
    throw new Error("Field Definition configuration is conflicted and cannot supply reversible evidence");
  }
  return first;
}

function hasEvidence(mutation: FieldDefinitionConfigMutation): boolean {
  return mutation.observedValueFactIds !== undefined && previousValue(mutation) !== undefined;
}

function previousValue(mutation: FieldDefinitionConfigMutation): unknown {
  return mutation.kind === "field-datatype-configure"
    ? mutation.previousDatatype
    : mutation.kind === "field-cardinality-configure"
      ? mutation.previousCardinality
      : mutation.previousExpression;
}

function withoutEvidence(mutation: FieldDefinitionConfigMutation): FieldDefinitionConfigMutation {
  if (mutation.kind === "field-datatype-configure") {
    return { ...mutation, previousDatatype: undefined, observedValueFactIds: undefined };
  }
  if (mutation.kind === "field-cardinality-configure") {
    return { ...mutation, previousCardinality: undefined, observedValueFactIds: undefined };
  }
  return { ...mutation, previousExpression: undefined, observedValueFactIds: undefined };
}
