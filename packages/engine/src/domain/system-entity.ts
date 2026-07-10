import type { Engine, NodeOccurrence } from "../core/index.js";
import {
  SystemEntityMeta,
  SystemKind,
  type FieldType,
  type FieldPresence,
} from "./bundle/system-schema.js";
import { invalidDomainInput } from "./errors.js";

export async function markFieldDef(
  engine: Engine,
  occurrenceId: string,
  fieldType: FieldType,
  presence: FieldPresence,
): Promise<void> {
  await engine.setEntityMeta(occurrenceId, SystemEntityMeta.SystemKind, SystemKind.FieldDef);
  await engine.setEntityMeta(occurrenceId, SystemEntityMeta.FieldType, fieldType);
  await engine.setEntityMeta(occurrenceId, SystemEntityMeta.Presence, presence);
}

export async function markField(
  engine: Engine,
  occurrenceId: string,
  fieldDefNodeId: string,
): Promise<void> {
  await engine.setEntityMeta(occurrenceId, SystemEntityMeta.SystemKind, SystemKind.Field);
  await engine.setEntityMeta(occurrenceId, SystemEntityMeta.FieldDefId, fieldDefNodeId);
}

export async function isSchema(engine: Engine, node: NodeOccurrence): Promise<boolean> {
  return (
    (await engine.getEntityMeta(node.occurrenceId, SystemEntityMeta.SystemKind)) ===
    SystemKind.Schema
  );
}

export async function isFieldDef(engine: Engine, node: NodeOccurrence): Promise<boolean> {
  return (
    (await engine.getEntityMeta(node.occurrenceId, SystemEntityMeta.SystemKind)) ===
    SystemKind.FieldDef
  );
}

export async function isField(engine: Engine, node: NodeOccurrence): Promise<boolean> {
  return (
    (await engine.getEntityMeta(node.occurrenceId, SystemEntityMeta.SystemKind)) ===
    SystemKind.Field
  );
}

export async function readFieldDefId(
  engine: Engine,
  field: NodeOccurrence,
): Promise<string | null> {
  const value = await engine.getEntityMeta(field.occurrenceId, SystemEntityMeta.FieldDefId);
  return typeof value === "string" ? value : null;
}

export async function readFieldDefPresence(
  engine: Engine,
  fieldDefOccurrenceId: string,
): Promise<FieldPresence | null> {
  const value = await engine.getEntityMeta(fieldDefOccurrenceId, SystemEntityMeta.Presence);
  return value === "normal" || value === "optional" ? value : null;
}

export async function requireSchema(
  engine: Engine,
  node: NodeOccurrence,
  nodeId: string,
): Promise<void> {
  if (!(await isSchema(engine, node))) {
    invalidDomainInput(`Node is not a schema: ${nodeId}`, { reason: "not_schema", nodeId });
  }
}

export async function requireFieldDef(
  engine: Engine,
  node: NodeOccurrence,
  nodeId: string,
): Promise<void> {
  if (!(await isFieldDef(engine, node))) {
    invalidDomainInput(`Node is not a fieldDef: ${nodeId}`, {
      reason: "not_field_def",
      nodeId,
    });
  }
}

export async function requireField(
  engine: Engine,
  node: NodeOccurrence,
  occurrenceId: string,
): Promise<void> {
  if (!(await isField(engine, node))) {
    invalidDomainInput(`Occurrence is not a field slot: ${occurrenceId}`, {
      reason: "not_field",
      occurrenceId,
    });
  }
}
