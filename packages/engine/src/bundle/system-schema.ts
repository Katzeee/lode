// Built-in schema vocabulary: system entity meta keys + field type/presence unions.
// Pure leaf — no engine/domain imports. The single source of truth for built-in
// schema, mirroring anytype-heart's pkg/lib/bundle. System supertags/fields declared
// here as the product grows.
export const SystemEntityMeta = {
  SystemKind: "systemKind",
  SchemaIds: "schemaIds",
  FieldType: "fieldType",
  Presence: "presence",
  FieldDefId: "fieldDefId",
} as const;

export const SystemKind = {
  Schema: "schema",
  FieldDef: "fieldDef",
  Field: "field",
} as const;

export type SystemKind = (typeof SystemKind)[keyof typeof SystemKind];
export type FieldType = "plain" | "reference" | "option" | "date" | "checkbox";
export type FieldPresence = "normal" | "optional";
