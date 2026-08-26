export type FieldInitializationExpression = Readonly<{
  kind: "find-field-values";
  sourceFieldDefinitionId: string;
}>;

export type FieldDefinitionConfigurationValue =
  | Readonly<{
      kind: "datatype";
      datatypeNodeId: string;
      optionsSupertagId?: string;
    }>
  | Readonly<{
      kind: "cardinality";
      cardinalityNodeId: string;
    }>
  | Readonly<{
      kind: "optionality";
      optionalityNodeId: string;
    }>
  | Readonly<{
      kind: "initialization-expression";
      expression: FieldInitializationExpression;
    }>;
