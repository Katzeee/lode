export type FieldContentRemovalAction =
  | Readonly<{
      kind: "field-value-remove";
      valuePlacementId: string;
    }>
  | Readonly<{
      kind: "materialized-field-clear";
      ownerNodeId: string;
      fieldDefinitionId: string;
    }>;
