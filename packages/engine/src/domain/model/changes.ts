// Pure value-type leaf: domain change vocabulary shared across the schema-reconcile
// pipeline and the wire mappers. No engine/domain-op imports.
export type DomainChangeKind = "fieldSlot" | "templateRef" | "fieldValue";
export type DomainChangeReason =
  | "created"
  | "reused"
  | "moved"
  | "deleted"
  | "kept"
  | "provenanceUpdated";

export type DomainChange = {
  kind: DomainChangeKind;
  reason: DomainChangeReason;
  nodeId: string;
  occurrenceId: string;
};
