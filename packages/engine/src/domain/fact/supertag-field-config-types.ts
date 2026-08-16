import type { FieldValueSeed } from "./field-value-types.js";

export type FieldVisibility = "pinned" | "normal" | "optional";

export type SupertagFieldConfig = Readonly<{
  visibility: FieldVisibility;
  staticDefault: readonly FieldValueSeed[] | null;
}>;

export const DEFAULT_SUPERTAG_FIELD_CONFIG: SupertagFieldConfig = {
  visibility: "normal",
  staticDefault: null,
};
