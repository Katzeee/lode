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
