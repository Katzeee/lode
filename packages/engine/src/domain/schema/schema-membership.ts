import type { Engine } from "../../core/index.js";
import { SystemEntityMeta } from "../bundle/system-schema.js";

export async function readSchemaIds(engine: Engine, occurrenceId: string): Promise<string[]> {
  const value = await engine.getEntityMeta(occurrenceId, SystemEntityMeta.SchemaIds);
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

export async function writeSchemaIds(
  engine: Engine,
  occurrenceId: string,
  schemaIds: string[],
): Promise<void> {
  if (schemaIds.length === 0) {
    await engine.unsetEntityMeta(occurrenceId, SystemEntityMeta.SchemaIds);
    return;
  }
  await engine.setEntityMeta(occurrenceId, SystemEntityMeta.SchemaIds, [...schemaIds]);
}
