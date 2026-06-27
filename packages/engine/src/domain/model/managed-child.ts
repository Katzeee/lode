// Pure value-type leaf: managed-child vocabulary shared across the schema-reconcile
// pipeline. No engine/domain-op imports.
export const ManagedKind = {
  FieldSlot: "fieldSlot",
  TemplateRef: "templateRef",
} as const;

export type ManagedKind = (typeof ManagedKind)[keyof typeof ManagedKind];

export type SchemaProvenance = {
  schemaId: string;
  schemaChildNodeId: string;
  schemaChildOccurrenceId: string;
};

export type ManagedChildState =
  | { status: "none" }
  | { status: "invalid"; reason: "invalid_managed_kind" | "invalid_provenance" }
  | { status: "valid"; kind: ManagedKind; provenance: SchemaProvenance[] };
