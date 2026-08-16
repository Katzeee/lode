import { compareFacts, isFieldDefinitionConfigMutation, type ContributionFact, type Mutation } from "../fact/index.js";
import { noCompensation, type CompensationStep } from "./compensation-types.js";

export function compensateFieldDefinitionConfiguration(
  target: ContributionFact,
  activeFacts: readonly ContributionFact[],
): CompensationStep | null {
  const mutation = target.body.mutation;
  if (!isFieldDefinitionConfigMutation(mutation)) {
    return null;
  }
  const hasPrevious =
    mutation.kind === "field-datatype-configure"
      ? mutation.previousDatatype != null
      : mutation.kind === "field-cardinality-configure"
        ? mutation.previousCardinality != null
        : mutation.previousExpression != null;
  if (!hasPrevious) {
    return noCompensation();
  }
  const changedLater = activeFacts.some((fact) => {
    const candidate = fact.body.mutation;
    return (
      compareFacts(target, fact) < 0 &&
      isFieldDefinitionConfigMutation(candidate) &&
      candidate.kind === mutation.kind &&
      candidate.configurationNodeId === mutation.configurationNodeId
    );
  });
  if (changedLater) {
    return noCompensation();
  }
  let compensation: Mutation;
  if (mutation.kind === "field-datatype-configure") {
    if (mutation.previousDatatype == null) {
      return noCompensation();
    }
    compensation = {
      ...mutation,
      datatype: mutation.previousDatatype,
      previousDatatype: mutation.datatype,
      observedValueFactIds: [target.id],
    };
  } else if (mutation.kind === "field-cardinality-configure") {
    if (mutation.previousCardinality == null) {
      return noCompensation();
    }
    compensation = {
      ...mutation,
      cardinality: mutation.previousCardinality,
      previousCardinality: mutation.cardinality,
      observedValueFactIds: [target.id],
    };
  } else {
    if (mutation.previousExpression == null) {
      return noCompensation();
    }
    compensation = {
      ...mutation,
      expression: mutation.previousExpression,
      previousExpression: mutation.expression,
      observedValueFactIds: [target.id],
    };
  }
  return { kind: "ready", mutations: [compensation] };
}
