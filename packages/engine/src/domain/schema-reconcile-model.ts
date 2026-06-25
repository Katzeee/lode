import type { DomainChange } from "./changes.js";
import type { ManagedKind, SchemaProvenance } from "./managed-child-state.js";

export type DesiredFieldSlotChild = {
  key: string;
  managedKind: typeof ManagedKind.FieldSlot;
  createIfMissing: boolean;
  fieldDefNodeId: string;
  provenance: SchemaProvenance[];
};

export type DesiredTemplateRefChild = {
  key: string;
  managedKind: typeof ManagedKind.TemplateRef;
  createIfMissing: true;
  templateNodeId: string;
  provenance: SchemaProvenance[];
};

export type DesiredManagedChild = DesiredFieldSlotChild | DesiredTemplateRefChild;

export type DesiredManagedChildInput =
  | (Omit<DesiredFieldSlotChild, "provenance"> & { provenance: SchemaProvenance })
  | (Omit<DesiredTemplateRefChild, "provenance"> & { provenance: SchemaProvenance });

export type AppliedManagedChildren = {
  changes: DomainChange[];
  assignedProvenanceByOccurrence: Map<string, SchemaProvenance[]>;
  managedOrder: string[];
};

export function provenanceKeyOf(entry: SchemaProvenance): string {
  return `${entry.schemaId}::${entry.schemaChildNodeId}::${entry.schemaChildOccurrenceId}`;
}

export function isSameProvenance(left: SchemaProvenance[], right: SchemaProvenance[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((entry, index) => {
    const next = right[index];
    if (!next) {
      return false;
    }
    return (
      entry.schemaId === next.schemaId &&
      entry.schemaChildNodeId === next.schemaChildNodeId &&
      entry.schemaChildOccurrenceId === next.schemaChildOccurrenceId
    );
  });
}
