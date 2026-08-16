import type { FactId } from "./types.js";

export type FieldDatatype = "plain" | "options";
export type FieldCardinality = "single" | "list";

export type FieldInitializationExpression = Readonly<{
  kind: "ancestor-field-values";
  sourceFieldDefinitionId: string;
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
        datatype: FieldDatatype;
        previousDatatype?: FieldDatatype | null;
      }>)
  | (FieldDefinitionConfigMutationBase &
      Readonly<{
        kind: "field-cardinality-configure";
        cardinality: FieldCardinality;
        previousCardinality?: FieldCardinality | null;
      }>)
  | (FieldDefinitionConfigMutationBase &
      Readonly<{
        kind: "field-initialization-expression-configure";
        expression: FieldInitializationExpression;
        previousExpression?: FieldInitializationExpression | null;
      }>);
