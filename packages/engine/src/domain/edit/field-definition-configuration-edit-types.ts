import type { FieldInitializationExpression, NodeSeed, SequenceAnchor } from "../fact/index.js";

type CreateFieldDefinitionConfigurationEditBase = Readonly<{
  fieldDefinitionId: string;
  configurationNodeId: string;
  configurationOccurrenceId: string;
  definitionOccurrenceId: string;
  anchor: SequenceAnchor;
  seed?: NodeSeed;
}>;

export type CreateFieldDefinitionConfigurationEdit =
  | (CreateFieldDefinitionConfigurationEditBase &
      Readonly<{
        kind: "field-datatype-configuration-create";
        datatypeNodeId: string;
        valueOccurrenceId: string;
        optionsSupertagId?: string;
        optionsSupertagOccurrenceId?: string;
      }>)
  | (CreateFieldDefinitionConfigurationEditBase &
      Readonly<{
        kind: "field-cardinality-configuration-create";
        cardinalityNodeId: string;
        valueOccurrenceId: string;
      }>)
  | (CreateFieldDefinitionConfigurationEditBase &
      Readonly<{
        kind: "field-optionality-configuration-create";
        optionalityNodeId: string;
        valueOccurrenceId: string;
      }>)
  | (CreateFieldDefinitionConfigurationEditBase &
      Readonly<{
        kind: "field-initialization-expression-configuration-create";
        expression: FieldInitializationExpression;
      }>);

type ConfigureFieldDefinitionEndpointEditBase = Readonly<{
  fieldDefinitionId: string;
  configurationNodeId: string;
  configurationOccurrenceId: string;
  valueOccurrenceId: string;
}>;

export type ConfigureFieldDefinitionEndpointEdit =
  | (ConfigureFieldDefinitionEndpointEditBase &
      Readonly<{
        kind: "field-datatype-configure";
        datatypeNodeId: string;
        optionsSupertagId?: string;
        optionsSupertagOccurrenceId?: string;
      }>)
  | (ConfigureFieldDefinitionEndpointEditBase &
      Readonly<{ kind: "field-cardinality-configure"; cardinalityNodeId: string }>)
  | (ConfigureFieldDefinitionEndpointEditBase &
      Readonly<{ kind: "field-optionality-configure"; optionalityNodeId: string }>);
