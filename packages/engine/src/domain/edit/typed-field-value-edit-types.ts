export type TypedFieldIdentity = Readonly<{
  ownerNodeId: string;
  fieldDefinitionId: string;
  fieldNodeId: string;
  fieldOccurrenceId: string;
}>;

type OwnedTypedFieldValueIdentity = TypedFieldIdentity &
  Readonly<{
    valueNodeId: string;
    valueOccurrenceId: string;
  }>;

export type TypedFieldValueEdit =
  | (OwnedTypedFieldValueIdentity & Readonly<{ kind: "field-number-value-set"; value: number }>)
  | (OwnedTypedFieldValueIdentity & Readonly<{ kind: "field-date-value-set"; value: string }>)
  | (TypedFieldIdentity & Readonly<{ kind: "field-checkbox-value-set"; valueOccurrenceId: string; value: boolean }>)
  | (TypedFieldIdentity &
      Readonly<{
        kind: "field-options-from-supertag-value-set";
        valueOccurrenceId: string;
        targetNodeId: string;
      }>)
  | (TypedFieldIdentity &
      Readonly<{
        kind: "typed-field-value-clear";
        emptyValueNodeId?: string;
        emptyValueOccurrenceId?: string;
      }>);
