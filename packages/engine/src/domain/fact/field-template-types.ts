export type FieldVisibility = "pinned" | "normal" | "optional";

export type FieldValueSeed =
  Readonly<{ kind: "text"; value: string }> | Readonly<{ kind: "reference"; nodeId: string }>;

export type InitializedFieldValue =
  | Readonly<{ kind: "text"; nodeId: string; occurrenceId: string; value: string }>
  | Readonly<{ kind: "reference"; nodeId: string; occurrenceId: string }>;

export type FieldInitializer =
  | Readonly<{ kind: "literal"; values: readonly FieldValueSeed[] }>
  | Readonly<{ kind: "application-node-text" }>;

export type FieldTemplateConfig = Readonly<{
  visibility: FieldVisibility;
  staticDefault: readonly FieldValueSeed[] | null;
  initializer: FieldInitializer | null;
}>;

export const DEFAULT_FIELD_TEMPLATE_CONFIG: FieldTemplateConfig = {
  visibility: "normal",
  staticDefault: null,
  initializer: null,
};
