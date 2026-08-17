import type { FactId } from "./types.js";

export type FieldInitializationExpression = Readonly<{
  kind: "find-field-values";
  expressionNodeId: string;
  expressionOccurrenceId: string;
  sourceFieldDefinitionId: string;
  sourceFieldDefinitionOccurrenceId: string;
  contextNodeId: string;
  contextOccurrenceId: string;
}>;

type FieldDefinitionConfigMutationBase = Readonly<{
  fieldDefinitionId: string;
  configurationNodeId: string;
  configurationOccurrenceId: string;
  observedValueFactIds?: readonly FactId[];
}>;

export type FieldDefinitionConfigMutation =
  | (FieldDefinitionConfigMutationBase &
      Readonly<{
        kind: "field-datatype-configure";
        datatypeNodeId: string;
        previousDatatypeNodeId?: string | null;
      }>)
  | (FieldDefinitionConfigMutationBase &
      Readonly<{
        kind: "field-cardinality-configure";
        cardinalityNodeId: string;
        previousCardinalityNodeId?: string | null;
      }>)
  | (FieldDefinitionConfigMutationBase &
      Readonly<{
        kind: "field-optionality-configure";
        optionalityNodeId: string;
        previousOptionalityNodeId?: string | null;
      }>)
  | (FieldDefinitionConfigMutationBase &
      Readonly<{
        kind: "field-initialization-expression-configure";
        expression: FieldInitializationExpression;
        previousExpression?: FieldInitializationExpression | null;
      }>);
