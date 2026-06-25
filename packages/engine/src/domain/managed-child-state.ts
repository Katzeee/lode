import type { Engine, NodeOccurrence } from "../core/index.js";
import { invalidDomainInput } from "./errors.js";
import { readSchemaIds } from "./schema-membership.js";

const ManagedOccurrenceMeta = {
  ManagedKind: "managedKind",
  ManagedBySchemas: "managedBySchemas",
} as const;

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

export function readManagedChildState(doc: Engine, occurrenceId: string): ManagedChildState {
  const kindValue = doc.getOccurrenceMeta(occurrenceId, ManagedOccurrenceMeta.ManagedKind);
  const provenanceValue = doc.getOccurrenceMeta(
    occurrenceId,
    ManagedOccurrenceMeta.ManagedBySchemas,
  );

  if (kindValue === undefined && provenanceValue === undefined) {
    return { status: "none" };
  }
  if (kindValue !== ManagedKind.FieldSlot && kindValue !== ManagedKind.TemplateRef) {
    return { status: "invalid", reason: "invalid_managed_kind" };
  }

  const provenance = readProvenance(provenanceValue);
  if (!provenance.valid) {
    return { status: "invalid", reason: "invalid_provenance" };
  }

  return { status: "valid", kind: kindValue, provenance: provenance.value };
}

export function writeManagedChildState(
  doc: Engine,
  occurrenceId: string,
  kind: ManagedKind,
  provenance: SchemaProvenance[],
): void {
  doc.setOccurrenceMeta(occurrenceId, ManagedOccurrenceMeta.ManagedKind, kind);
  doc.setOccurrenceMeta(
    occurrenceId,
    ManagedOccurrenceMeta.ManagedBySchemas,
    provenance.map((entry) => ({ ...entry })),
  );
}

export function writeManagedProvenance(
  doc: Engine,
  occurrenceId: string,
  provenance: SchemaProvenance[],
): void {
  doc.setOccurrenceMeta(
    occurrenceId,
    ManagedOccurrenceMeta.ManagedBySchemas,
    provenance.map((entry) => ({ ...entry })),
  );
}

export function isActiveManagedChild(
  doc: Engine,
  parent: NodeOccurrence,
  child: NodeOccurrence,
): boolean {
  const parentSchemaIds = new Set(readSchemaIds(doc, parent.occurrenceId));
  if (parentSchemaIds.size === 0) {
    return false;
  }

  const managed = readManagedChildState(doc, child.occurrenceId);
  if (managed.status !== "valid") {
    return false;
  }

  return managed.provenance.some((entry) => parentSchemaIds.has(entry.schemaId));
}

export function requireManagedKind(
  doc: Engine,
  child: NodeOccurrence,
): "fieldSlot" | "templateRef" {
  const managed = readManagedChildState(doc, child.occurrenceId);
  if (managed.status === "valid") {
    return managed.kind;
  }
  invalidDomainInput(`Invalid managed child state: ${child.occurrenceId}`, {
    reason: "invalid_managed_child",
    occurrenceId: child.occurrenceId,
  });
}

export function managedKindValue(
  doc: Engine,
  child: NodeOccurrence,
): "fieldSlot" | "templateRef" | null {
  const managed = readManagedChildState(doc, child.occurrenceId);
  return managed.status === "valid" ? managed.kind : null;
}

function readProvenance(value: unknown): { valid: boolean; value: SchemaProvenance[] } {
  if (!Array.isArray(value)) {
    return { valid: false, value: [] };
  }

  const provenance: SchemaProvenance[] = [];
  for (const entry of value) {
    if (
      typeof entry !== "object" ||
      entry == null ||
      typeof (entry as Record<string, unknown>).schemaId !== "string" ||
      typeof (entry as Record<string, unknown>).schemaChildNodeId !== "string" ||
      typeof (entry as Record<string, unknown>).schemaChildOccurrenceId !== "string"
    ) {
      return { valid: false, value: [] };
    }
    const e = entry as {
      schemaId: string;
      schemaChildNodeId: string;
      schemaChildOccurrenceId: string;
    };
    provenance.push({
      schemaId: e.schemaId,
      schemaChildNodeId: e.schemaChildNodeId,
      schemaChildOccurrenceId: e.schemaChildOccurrenceId,
    });
  }

  return { valid: true, value: provenance };
}
