import type { FactActionId } from "./types.js";

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

export type FieldConfigurationSetAction = Readonly<{
  kind: "field-configuration-set";
  fieldDefinitionId: string;
  configuration: FieldDefinitionConfigurationValue;
}>;

type FieldDefinitionLifecycleAction =
  | Readonly<{
      kind: "field-definition-make-discoverable";
      fieldDefinitionId: string;
    }>
  | Readonly<{
      kind: "field-definition-return-to-template-field";
      fieldDefinitionId: string;
      templateFieldId: FactActionId;
    }>;

export type FieldDefinitionAction = FieldConfigurationSetAction | FieldDefinitionLifecycleAction;
