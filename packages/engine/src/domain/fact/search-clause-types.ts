export type SearchClauseMutation =
  | Readonly<{
      kind: "search-supertag-clause-attach";
      searchNodeId: string;
      clauseNodeId: string;
      clauseOccurrenceId: string;
      supertagId: string;
    }>
  | Readonly<{
      kind: "search-field-clause-attach";
      searchNodeId: string;
      clauseNodeId: string;
      clauseOccurrenceId: string;
      fieldDefinitionId: string;
    }>;
