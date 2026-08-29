import { END_SEQUENCE_ANCHOR as end } from "@lode/sdk";
import type { EditAction } from "@lode/sdk";

export function templateFieldCreateAction(supertagId: string, fieldDefinitionId: string, name: string): EditAction {
  return {
    kind: "supertag-template-field-create",
    supertagId,
    fieldDefinitionId,
    anchor: end,
    fieldDefinitionSeed: { text: [{ value: name, attributes: {} }] },
  };
}

export function datatypeConfiguration(
  fieldDefinitionId: string,
  datatype: string,
  optionsFrom: string | undefined,
): EditAction {
  return {
    kind: "field-datatype-configure",
    fieldDefinitionId,
    datatypeNodeId: `system-field-datatype:v1:${datatype}`,
    ...(optionsFrom === undefined ? {} : { optionsSupertagId: optionsFrom }),
  };
}

export function cardinalityConfiguration(fieldDefinitionId: string, endpoint: string): EditAction {
  return {
    kind: "field-cardinality-configure",
    fieldDefinitionId,
    cardinalityNodeId: endpoint,
  };
}

export function optionalityConfiguration(fieldDefinitionId: string, endpoint: string): EditAction {
  return {
    kind: "field-optionality-configure",
    fieldDefinitionId,
    optionalityNodeId: endpoint,
  };
}

export function requiredEndpoint(required: boolean): string {
  return required ? "system-field-optionality:v1:required" : "system-field-optionality:v1:not-required";
}

export function optionalContributionActions(supertagId: string, fieldDefinitionId: string): readonly EditAction[] {
  return [
    {
      kind: "supertag-optional-field-contribution-add",
      supertagId,
      fieldDefinitionId,
      anchor: end,
    },
  ];
}
