import type { EditMutation } from "@lode/sdk";

import { identity } from "../intent/index.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

export function templateFieldCreateMutation(
  requestId: string,
  supertagId: string,
  fieldDefinitionId: string,
  name: string,
): EditMutation {
  return {
    kind: "supertag-template-field-create",
    supertagId,
    templateFieldNodeId: identity(requestId, "template-field"),
    templateFieldOccurrenceId: identity(requestId, "template-field-occurrence"),
    fieldDefinitionId,
    definitionOccurrenceId: identity(requestId, "definition-occurrence"),
    staticDefaultValueNodeId: identity(requestId, "default-node"),
    staticDefaultValueOccurrenceId: identity(requestId, "default-occurrence"),
    anchor: end,
    fieldDefinitionSeed: { text: [{ value: name, attributes: {} }] },
  };
}

export function definitionConfigurationMutations(
  requestId: string,
  fieldDefinitionId: string,
  datatype: string,
  optionsFrom: string | undefined,
): readonly EditMutation[] {
  const configurationNodeId = identity(requestId, "datatype-configuration");
  const base = {
    fieldDefinitionId,
    configurationNodeId,
    configurationOccurrenceId: `${configurationNodeId}-occurrence`,
    definitionOccurrenceId: `${configurationNodeId}-definition`,
    valueOccurrenceId: `${configurationNodeId}-value`,
    datatypeNodeId: `system-field-datatype:v1:${datatype}`,
    anchor: end,
  };
  if (datatype !== "options-from-supertag") {
    return [{ kind: "field-datatype-configuration-create", ...base }];
  }
  return [
    {
      kind: "field-datatype-configuration-create",
      ...base,
      optionsSupertagId: optionsFrom,
      optionsSupertagOccurrenceId: `${configurationNodeId}-options-supertag`,
    },
  ];
}

export function cardinalityConfiguration(requestId: string, fieldDefinitionId: string, endpoint: string): EditMutation {
  const configurationNodeId = identity(requestId, "cardinality-configuration");
  return {
    kind: "field-cardinality-configuration-create",
    fieldDefinitionId,
    configurationNodeId,
    configurationOccurrenceId: `${configurationNodeId}-occurrence`,
    definitionOccurrenceId: `${configurationNodeId}-definition`,
    valueOccurrenceId: `${configurationNodeId}-value`,
    cardinalityNodeId: endpoint,
    anchor: end,
  };
}

export function optionalityConfiguration(requestId: string, fieldDefinitionId: string, endpoint: string): EditMutation {
  const configurationNodeId = identity(requestId, "optionality-configuration");
  return {
    kind: "field-optionality-configuration-create",
    fieldDefinitionId,
    configurationNodeId,
    configurationOccurrenceId: `${configurationNodeId}-occurrence`,
    definitionOccurrenceId: `${configurationNodeId}-definition`,
    valueOccurrenceId: `${configurationNodeId}-value`,
    optionalityNodeId: endpoint,
    anchor: end,
  };
}

export function requiredEndpoint(required: boolean): string {
  return required ? "system-field-optionality:v1:required" : "system-field-optionality:v1:not-required";
}

export function optionalContributionMutations(
  requestId: string,
  supertagId: string,
  fieldDefinitionId: string,
  seed: Readonly<{ name?: string }>,
): readonly EditMutation[] {
  const contributionNodeId = identity(requestId, "optional-contribution");
  const nurseryNodeId = `${supertagId}-optional-fields`;
  const definitionSeed =
    seed.name === undefined ? {} : { fieldDefinitionSeed: { text: [{ value: seed.name, attributes: {} }] } };
  return [
    {
      kind: "supertag-optional-field-contribution-add",
      supertagId,
      metanodeId: `${supertagId}-metanode`,
      fieldNurseryNodeId: nurseryNodeId,
      fieldNurseryOccurrenceId: `${nurseryNodeId}-occurrence`,
      nurseryDefinitionOccurrenceId: `${nurseryNodeId}-definition`,
      nurseryValueNodeId: `${nurseryNodeId}-value`,
      nurseryValueOccurrenceId: `${nurseryNodeId}-value-occurrence`,
      contributionNodeId,
      contributionOccurrenceId: `${contributionNodeId}-occurrence`,
      fieldDefinitionId,
      definitionOccurrenceId: `${contributionNodeId}-definition`,
      valueNodeId: `${contributionNodeId}-value`,
      valueOccurrenceId: `${contributionNodeId}-value-occurrence`,
      anchor: end,
      ...definitionSeed,
    },
  ];
}
