import type { FieldInitializationExpression } from "../fact/index.js";

type ConfigureFieldDefinitionEditBase = Readonly<{
  fieldDefinitionId: string;
}>;

export type ConfigureFieldDefinitionEdit =
  | (ConfigureFieldDefinitionEditBase &
      Readonly<{
        kind: "field-datatype-configure";
        datatypeNodeId: string;
        optionsSupertagId?: string;
      }>)
  | (ConfigureFieldDefinitionEditBase &
      Readonly<{
        kind: "field-cardinality-configure";
        cardinalityNodeId: string;
      }>)
  | (ConfigureFieldDefinitionEditBase &
      Readonly<{
        kind: "field-optionality-configure";
        optionalityNodeId: string;
      }>)
  | (ConfigureFieldDefinitionEditBase &
      Readonly<{
        kind: "field-initialization-expression-configure";
        expression: FieldInitializationExpression;
      }>);
