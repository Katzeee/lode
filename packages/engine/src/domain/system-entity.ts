import type { Engine, NodeOccurrence } from "../core/index.js";
import { invalidDomainInput } from "./errors.js";

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

export function markFieldDef(
  doc: Engine,
  occurrenceId: string,
  fieldType: FieldType,
  presence: FieldPresence,
): void {
  doc.setEntityMeta(occurrenceId, SystemEntityMeta.SystemKind, SystemKind.FieldDef);
  doc.setEntityMeta(occurrenceId, SystemEntityMeta.FieldType, fieldType);
  doc.setEntityMeta(occurrenceId, SystemEntityMeta.Presence, presence);
}

export function markField(doc: Engine, occurrenceId: string, fieldDefNodeId: string): void {
  doc.setEntityMeta(occurrenceId, SystemEntityMeta.SystemKind, SystemKind.Field);
  doc.setEntityMeta(occurrenceId, SystemEntityMeta.FieldDefId, fieldDefNodeId);
}

export function isSchema(doc: Engine, node: NodeOccurrence): boolean {
  return doc.getEntityMeta(node.occurrenceId, SystemEntityMeta.SystemKind) === SystemKind.Schema;
}

export function isFieldDef(doc: Engine, node: NodeOccurrence): boolean {
  return doc.getEntityMeta(node.occurrenceId, SystemEntityMeta.SystemKind) === SystemKind.FieldDef;
}

export function isField(doc: Engine, node: NodeOccurrence): boolean {
  return doc.getEntityMeta(node.occurrenceId, SystemEntityMeta.SystemKind) === SystemKind.Field;
}

export function readFieldDefId(doc: Engine, field: NodeOccurrence): string | null {
  const value = doc.getEntityMeta(field.occurrenceId, SystemEntityMeta.FieldDefId);
  return typeof value === "string" ? value : null;
}

export function readFieldDefPresence(
  doc: Engine,
  fieldDefOccurrenceId: string,
): FieldPresence | null {
  const value = doc.getEntityMeta(fieldDefOccurrenceId, SystemEntityMeta.Presence);
  return value === "normal" || value === "optional" ? value : null;
}

export function requireSchema(doc: Engine, node: NodeOccurrence, nodeId: string): void {
  if (!isSchema(doc, node)) {
    invalidDomainInput(`Node is not a schema: ${nodeId}`, { reason: "not_schema", nodeId });
  }
}

export function requireFieldDef(doc: Engine, node: NodeOccurrence, nodeId: string): void {
  if (!isFieldDef(doc, node)) {
    invalidDomainInput(`Node is not a fieldDef: ${nodeId}`, {
      reason: "not_field_def",
      nodeId,
    });
  }
}

export function requireField(doc: Engine, node: NodeOccurrence, occurrenceId: string): void {
  if (!isField(doc, node)) {
    invalidDomainInput(`Occurrence is not a field slot: ${occurrenceId}`, {
      reason: "not_field",
      occurrenceId,
    });
  }
}
