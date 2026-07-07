import type { Engine, NodeOccurrence } from "../core/index.js";
import {
  SystemEntityMeta,
  SystemKind,
  type FieldType,
  type FieldPresence,
} from "../bundle/system-schema.js";
import { invalidDomainInput } from "./errors.js";

export async function markFieldDef(
  doc: Engine,
  occurrenceId: string,
  fieldType: FieldType,
  presence: FieldPresence,
): Promise<void> {
  await doc.setEntityMeta(occurrenceId, SystemEntityMeta.SystemKind, SystemKind.FieldDef);
  await doc.setEntityMeta(occurrenceId, SystemEntityMeta.FieldType, fieldType);
  await doc.setEntityMeta(occurrenceId, SystemEntityMeta.Presence, presence);
}

export async function markField(
  doc: Engine,
  occurrenceId: string,
  fieldDefNodeId: string,
): Promise<void> {
  await doc.setEntityMeta(occurrenceId, SystemEntityMeta.SystemKind, SystemKind.Field);
  await doc.setEntityMeta(occurrenceId, SystemEntityMeta.FieldDefId, fieldDefNodeId);
}

export async function isSchema(doc: Engine, node: NodeOccurrence): Promise<boolean> {
  return (
    (await doc.getEntityMeta(node.occurrenceId, SystemEntityMeta.SystemKind)) === SystemKind.Schema
  );
}

export async function isFieldDef(doc: Engine, node: NodeOccurrence): Promise<boolean> {
  return (
    (await doc.getEntityMeta(node.occurrenceId, SystemEntityMeta.SystemKind)) ===
    SystemKind.FieldDef
  );
}

export async function isField(doc: Engine, node: NodeOccurrence): Promise<boolean> {
  return (
    (await doc.getEntityMeta(node.occurrenceId, SystemEntityMeta.SystemKind)) === SystemKind.Field
  );
}

export async function readFieldDefId(doc: Engine, field: NodeOccurrence): Promise<string | null> {
  const value = await doc.getEntityMeta(field.occurrenceId, SystemEntityMeta.FieldDefId);
  return typeof value === "string" ? value : null;
}

export async function readFieldDefPresence(
  doc: Engine,
  fieldDefOccurrenceId: string,
): Promise<FieldPresence | null> {
  const value = await doc.getEntityMeta(fieldDefOccurrenceId, SystemEntityMeta.Presence);
  return value === "normal" || value === "optional" ? value : null;
}

export async function requireSchema(
  doc: Engine,
  node: NodeOccurrence,
  nodeId: string,
): Promise<void> {
  if (!(await isSchema(doc, node))) {
    invalidDomainInput(`Node is not a schema: ${nodeId}`, { reason: "not_schema", nodeId });
  }
}

export async function requireFieldDef(
  doc: Engine,
  node: NodeOccurrence,
  nodeId: string,
): Promise<void> {
  if (!(await isFieldDef(doc, node))) {
    invalidDomainInput(`Node is not a fieldDef: ${nodeId}`, {
      reason: "not_field_def",
      nodeId,
    });
  }
}

export async function requireField(
  doc: Engine,
  node: NodeOccurrence,
  occurrenceId: string,
): Promise<void> {
  if (!(await isField(doc, node))) {
    invalidDomainInput(`Occurrence is not a field slot: ${occurrenceId}`, {
      reason: "not_field",
      occurrenceId,
    });
  }
}
