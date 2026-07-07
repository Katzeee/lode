import type { Engine, NodeOccurrence } from "../core/index.js";
import {
  ManagedKind,
  type ManagedChildState,
  type SchemaProvenance,
} from "./model/managed-child.js";
import { invalidDomainInput } from "./errors.js";
import { readSchemaIds } from "./schema-membership.js";

const ManagedOccurrenceMeta = {
  KindKey: "managedKind",
  ManagedBySchemas: "managedBySchemas",
} as const;

// Occurrence-meta reads are treeDoc-only (sync) — the managed-child state lives on the tree node's
// `data`, so these never fault a shard. Writes are mutators (async via the grouping envelope).
export function readManagedChildState(doc: Engine, occurrenceId: string): ManagedChildState {
  const kindValue = doc.getOccurrenceMeta(occurrenceId, ManagedOccurrenceMeta.KindKey);
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

export async function writeManagedProvenance(
  doc: Engine,
  occurrenceId: string,
  provenance: SchemaProvenance[],
): Promise<void> {
  await doc.setOccurrenceMeta(
    occurrenceId,
    ManagedOccurrenceMeta.ManagedBySchemas,
    provenance.map((entry) => ({ ...entry })),
  );
}

export async function writeManagedChildState(
  doc: Engine,
  occurrenceId: string,
  kind: ManagedKind,
  provenance: SchemaProvenance[],
): Promise<void> {
  await doc.setOccurrenceMeta(occurrenceId, ManagedOccurrenceMeta.KindKey, kind);
  await writeManagedProvenance(doc, occurrenceId, provenance);
}

export async function isActiveManagedChild(
  doc: Engine,
  parent: NodeOccurrence,
  child: NodeOccurrence,
): Promise<boolean> {
  const parentSchemaIds = new Set(await readSchemaIds(doc, parent.occurrenceId));
  if (parentSchemaIds.size === 0) {
    return false;
  }

  const managed = readManagedChildState(doc, child.occurrenceId);
  if (managed.status !== "valid") {
    return false;
  }

  return managed.provenance.some((entry) => parentSchemaIds.has(entry.schemaId));
}

export function requireManagedKind(doc: Engine, child: NodeOccurrence): ManagedKind {
  const managed = readManagedChildState(doc, child.occurrenceId);
  if (managed.status === "valid") {
    return managed.kind;
  }
  invalidDomainInput(`Invalid managed child state: ${child.occurrenceId}`, {
    reason: "invalid_managed_child",
    occurrenceId: child.occurrenceId,
  });
}

export function managedKindValue(doc: Engine, child: NodeOccurrence): ManagedKind | null {
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
