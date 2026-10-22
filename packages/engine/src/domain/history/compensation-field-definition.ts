import { canonicalJson, type GraphAction } from "../fact/index.js";
import type {
  FieldDefinitionConfiguration,
  InterpretedProjection,
  InterpretedProjectionGeneration,
} from "../reconcile/index.js";
import { noCompensation, type CompensationCatalog } from "./compensation-types.js";

export const FIELD_DEFINITION_COMPENSATIONS = {
  "field-configuration-set": () => noCompensation(),
  "field-definition-return-to-template-field": (_context, { action }) => ({
    kind: "ready",
    actions: [{ kind: "field-definition-make-discoverable", fieldDefinitionId: action.fieldDefinitionId }],
  }),
  "field-definition-make-discoverable": ({ projection, counterfactual }, { action }) => {
    const previousOwner = Object.values(counterfactual.templateFields)
      .flat()
      .find(
        (field) =>
          field.fieldDefinitionId === action.fieldDefinitionId && field.fieldDefinitionOwner === "template-field",
      );
    if (previousOwner === undefined || hasOtherUses(projection, action.fieldDefinitionId, previousOwner.factActionId)) {
      return noCompensation();
    }
    return {
      kind: "ready",
      actions: [
        {
          kind: "field-definition-return-to-template-field",
          fieldDefinitionId: action.fieldDefinitionId,
          templateFieldId: previousOwner.factActionId,
        },
      ],
    };
  },
} satisfies Partial<CompensationCatalog>;

export function fieldDefinitionConfigurationCompensations(
  current: InterpretedProjectionGeneration["origin"],
  counterfactual: InterpretedProjectionGeneration["origin"],
  planned: readonly GraphAction[],
): readonly GraphAction[] {
  const result: GraphAction[] = [];
  for (const [fieldDefinitionId, configurations] of Object.entries(counterfactual.fieldDefinitionConfigurations)) {
    for (const configuration of configurations) {
      const previous = current.fieldDefinitionConfigurations[fieldDefinitionId]?.find(
        (candidate) => candidate.kind === configuration.kind,
      );
      if (
        previous === undefined ||
        sameConfigurationValue(previous, configuration) ||
        planned.some(
          (action) =>
            action.kind === "field-configuration-set" &&
            action.fieldDefinitionId === fieldDefinitionId &&
            action.configuration.kind === configuration.kind,
        )
      ) {
        continue;
      }
      result.push({
        kind: "field-configuration-set",
        fieldDefinitionId,
        configuration: configurationValue(configuration),
      });
    }
  }
  return result;
}

function hasOtherUses(projection: InterpretedProjection, fieldDefinitionId: string, templateFieldId: string): boolean {
  return (
    Object.values(projection.templateFields)
      .flat()
      .some((field) => field.fieldDefinitionId === fieldDefinitionId && field.factActionId !== templateFieldId) ||
    Object.values(projection.optionalFieldContributions)
      .flat()
      .some((field) => field.fieldDefinitionId === fieldDefinitionId)
  );
}

function configurationValue(configuration: FieldDefinitionConfiguration) {
  if (configuration.kind === "datatype") {
    return {
      kind: "datatype" as const,
      datatypeNodeId: configuration.datatypeNodeId,
      ...(configuration.optionsSupertagId === null ? {} : { optionsSupertagId: configuration.optionsSupertagId }),
    };
  }
  if (configuration.kind === "cardinality") {
    return { kind: "cardinality" as const, cardinalityNodeId: configuration.cardinalityNodeId };
  }
  if (configuration.kind === "optionality") {
    return { kind: "optionality" as const, optionalityNodeId: configuration.optionalityNodeId };
  }
  return {
    kind: "initialization-expression" as const,
    expression: {
      kind: configuration.expression.kind,
      sourceFieldDefinitionId: configuration.expression.sourceFieldDefinitionId,
    },
  };
}

function sameConfigurationValue(left: FieldDefinitionConfiguration, right: FieldDefinitionConfiguration): boolean {
  return canonicalJson(configurationValue(left)) === canonicalJson(configurationValue(right));
}
