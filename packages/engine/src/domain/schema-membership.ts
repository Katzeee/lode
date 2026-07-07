import type { Engine } from "../core/index.js";
import { SystemEntityMeta } from "../bundle/system-schema.js";

export async function readSchemaIds(doc: Engine, occurrenceId: string): Promise<string[]> {
  const value = await doc.getEntityMeta(occurrenceId, SystemEntityMeta.SchemaIds);
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

export async function writeSchemaIds(
  doc: Engine,
  occurrenceId: string,
  schemaIds: string[],
): Promise<void> {
  if (schemaIds.length === 0) {
    await doc.unsetEntityMeta(occurrenceId, SystemEntityMeta.SchemaIds);
    return;
  }
  await doc.setEntityMeta(occurrenceId, SystemEntityMeta.SchemaIds, [...schemaIds]);
}
