import type { ManagedKind } from "./managed-child.js";

// Pure value-type leaf: domain change vocabulary shared across the schema-reconcile pipeline and the
// wire mappers. The only import is a type from the sibling managed-child value leaf.
/** What a `DomainChange` reports: a managed-child kind (sourced from `ManagedKind` — the single source
 *  of truth, so adding a managed kind auto-extends this union) or a `fieldValue` (a value written into
 *  a field, not a managed child). Deriving from `ManagedKind` makes the change-construction sites
 *  (`kind: desired.managedKind`) type-safe by construction, not by literal coincidence. */
export type DomainChangeKind = ManagedKind | "fieldValue";
export type DomainChangeReason =
  "created" | "reused" | "moved" | "deleted" | "kept" | "provenanceUpdated";

export type DomainChange = {
  kind: DomainChangeKind;
  reason: DomainChangeReason;
  nodeId: string;
  occurrenceId: string;
};
