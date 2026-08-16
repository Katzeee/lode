export type FieldValueSeed =
  Readonly<{ kind: "text"; value: string }> | Readonly<{ kind: "reference"; nodeId: string }>;

export type InitializedFieldValue =
  | Readonly<{ kind: "text"; nodeId: string; occurrenceId: string; value: string }>
  | Readonly<{ kind: "reference"; nodeId: string; occurrenceId: string }>;
