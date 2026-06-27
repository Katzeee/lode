import type { Engine } from "../core/index.js";
import { SystemEntityMeta } from "../bundle/system-schema.js";

export function readSchemaIds(doc: Engine, occurrenceId: string): string[] {
  const value = doc.getEntityMeta(occurrenceId, SystemEntityMeta.SchemaIds);
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

export function writeSchemaIds(doc: Engine, occurrenceId: string, schemaIds: string[]): void {
  if (schemaIds.length === 0) {
    doc.unsetEntityMeta(occurrenceId, SystemEntityMeta.SchemaIds);
    return;
  }
  doc.setEntityMeta(occurrenceId, SystemEntityMeta.SchemaIds, [...schemaIds]);
}
