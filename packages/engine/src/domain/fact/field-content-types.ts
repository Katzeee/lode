type FieldContentAnchor = Readonly<{
  after: string | null;
  before: string | null;
  affinity: "after" | "before";
  fallback: "start" | "end";
}>;

export type FieldContentDeletionMutation =
  | Readonly<{
      kind: "field-value-delete";
      ownerNodeId: string;
      fieldDefinitionId: string;
      valueOccurrenceId: string;
      previousParentNodeId?: string;
      previousAnchor?: FieldContentAnchor;
    }>
  | Readonly<{
      kind: "materialized-field-delete";
      ownerNodeId: string;
      fieldDefinitionId: string;
      fieldNodeId: string;
      fieldOccurrenceId: string;
      previousParentNodeId?: string;
      previousAnchor?: FieldContentAnchor;
    }>;
