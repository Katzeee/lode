import {
  canonicalJson,
  compareFacts,
  isFieldDefinitionConfigMutation,
  type ContributionFact,
  type Mutation,
} from "../fact/index.js";
import type { ScopedProjectionGeneration } from "../reconcile/index.js";
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
      ? mutation.previousDatatypeNodeId != null
      : mutation.kind === "field-cardinality-configure"
        ? mutation.previousCardinalityNodeId != null
        : mutation.kind === "field-optionality-configure"
          ? mutation.previousOptionalityNodeId != null
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
    if (mutation.previousDatatypeNodeId == null) {
      return noCompensation();
    }
    compensation = {
      ...mutation,
      datatypeNodeId: mutation.previousDatatypeNodeId,
      previousDatatypeNodeId: mutation.datatypeNodeId,
      observedValueFactIds: [target.id],
    };
  } else if (mutation.kind === "field-cardinality-configure") {
    if (mutation.previousCardinalityNodeId == null) {
      return noCompensation();
    }
    compensation = {
      ...mutation,
      cardinalityNodeId: mutation.previousCardinalityNodeId,
      previousCardinalityNodeId: mutation.cardinalityNodeId,
      observedValueFactIds: [target.id],
    };
  } else if (mutation.kind === "field-optionality-configure") {
    if (mutation.previousOptionalityNodeId == null) {
      return noCompensation();
    }
    compensation = {
      ...mutation,
      optionalityNodeId: mutation.previousOptionalityNodeId,
      previousOptionalityNodeId: mutation.optionalityNodeId,
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

export function fieldDefinitionConfigurationCompensations(
  current: ScopedProjectionGeneration["origin"],
  counterfactual: ScopedProjectionGeneration["origin"],
  planned: readonly Mutation[],
): readonly Mutation[] {
  const result: Mutation[] = [];
  for (const [fieldDefinitionId, configurations] of Object.entries(counterfactual.fieldDefinitionConfigurations)) {
    for (const configuration of configurations) {
      const previous = current.fieldDefinitionConfigurations[fieldDefinitionId]?.find(
        (candidate) => candidate.configurationNodeId === configuration.configurationNodeId,
      );
      if (
        previous === undefined ||
        previous.contributionId === configuration.contributionId ||
        sameConfigurationState(previous, configuration) ||
        planned.some(
          (mutation) =>
            isFieldDefinitionConfigMutation(mutation) &&
            mutation.configurationNodeId === configuration.configurationNodeId,
        )
      ) {
        continue;
      }
      if (configuration.kind === "datatype" && previous.kind === "datatype") {
        result.push({
          kind: "field-datatype-configure",
          fieldDefinitionId,
          configurationNodeId: configuration.configurationNodeId,
          configurationOccurrenceId: configuration.configurationOccurrenceId,
          datatypeNodeId: configuration.datatypeNodeId,
          previousDatatypeNodeId: previous.datatypeNodeId,
          observedValueFactIds: [previous.contributionId],
        });
      } else if (configuration.kind === "cardinality" && previous.kind === "cardinality") {
        result.push({
          kind: "field-cardinality-configure",
          fieldDefinitionId,
          configurationNodeId: configuration.configurationNodeId,
          configurationOccurrenceId: configuration.configurationOccurrenceId,
          cardinalityNodeId: configuration.cardinalityNodeId,
          previousCardinalityNodeId: previous.cardinalityNodeId,
          observedValueFactIds: [previous.contributionId],
        });
      } else if (configuration.kind === "optionality" && previous.kind === "optionality") {
        result.push({
          kind: "field-optionality-configure",
          fieldDefinitionId,
          configurationNodeId: configuration.configurationNodeId,
          configurationOccurrenceId: configuration.configurationOccurrenceId,
          optionalityNodeId: configuration.optionalityNodeId,
          previousOptionalityNodeId: previous.optionalityNodeId,
          observedValueFactIds: [previous.contributionId],
        });
      } else if (configuration.kind === "initialization-expression" && previous.kind === "initialization-expression") {
        result.push({
          kind: "field-initialization-expression-configure",
          fieldDefinitionId,
          configurationNodeId: configuration.configurationNodeId,
          configurationOccurrenceId: configuration.configurationOccurrenceId,
          expression: configuration.expression,
          previousExpression: previous.expression,
          observedValueFactIds: [previous.contributionId],
        });
      }
    }
  }
  return result;
}

function sameConfigurationState(
  left: ScopedProjectionGeneration["origin"]["fieldDefinitionConfigurations"][string][number],
  right: ScopedProjectionGeneration["origin"]["fieldDefinitionConfigurations"][string][number],
): boolean {
  const { contributionId: _leftContributionId, ...leftState } = left;
  const { contributionId: _rightContributionId, ...rightState } = right;
  return canonicalJson(leftState) === canonicalJson(rightState);
}
