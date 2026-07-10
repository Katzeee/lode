import { type Engine, textToDelta } from "../../core/index.js";
import { SystemEntityMeta, SystemKind } from "../bundle/system-schema.js";
import type { DomainChange } from "../model/changes.js";
import type { SchemaChangeResult, SchemaIdentity } from "../model/schema.js";
import { invalidDomainInput } from "../errors.js";
import { requireCanonicalOccurrence, requireNodeById } from "../lookup.js";
import { readSchemaIds, writeSchemaIds } from "./schema-membership.js";
import { requireSchema } from "../system-entity.js";
import { createPlainNode } from "../node/node.js";
import { cleanupInactiveManagedChildren, reconcileTargetSchemas } from "./schema-reconcile.js";

export async function createSchema(
  engine: Engine,
  name: string,
  parentOccurrenceId: string,
): Promise<SchemaIdentity> {
  if (!(await engine.getOccurrence(parentOccurrenceId))) {
    invalidDomainInput(`Occurrence not found: ${parentOccurrenceId}`, {
      reason: "occurrence_not_found",
      occurrenceId: parentOccurrenceId,
    });
  }
  const schema = await createPlainNode(engine, parentOccurrenceId);
  await engine.setEntityMeta(schema.occurrenceId, SystemEntityMeta.SystemKind, SystemKind.Schema);
  await engine.replaceDeltas(schema.occurrenceId, textToDelta(name));
  return { nodeId: schema.nodeId, occurrenceId: schema.occurrenceId };
}

export async function applySchema(
  engine: Engine,
  targetOccurrenceId: string,
  schemaNodeId: string,
): Promise<SchemaChangeResult> {
  const target = await requireCanonicalOccurrence(engine, targetOccurrenceId);
  const schema = await requireNodeById(engine, schemaNodeId);
  await requireSchema(engine, schema, schemaNodeId);

  let changes: DomainChange[] = [];
  await engine.batch(async () => {
    const schemaIds = await readSchemaIds(engine, target.occurrenceId);
    if (!schemaIds.includes(schema.nodeId)) {
      await writeSchemaIds(engine, target.occurrenceId, [...schemaIds, schema.nodeId]);
    }
    changes = await reconcileAndCleanup(engine, target.occurrenceId);
  });

  return {
    target: { nodeId: target.nodeId, occurrenceId: target.occurrenceId },
    schema: { nodeId: schema.nodeId },
    changes,
  };
}

export async function removeSchema(
  engine: Engine,
  targetOccurrenceId: string,
  schemaNodeId: string,
): Promise<SchemaChangeResult> {
  const target = await requireCanonicalOccurrence(engine, targetOccurrenceId);
  const schema = await requireNodeById(engine, schemaNodeId);
  await requireSchema(engine, schema, schemaNodeId);

  let changes: DomainChange[] = [];
  await engine.batch(async () => {
    const schemaIds = await readSchemaIds(engine, target.occurrenceId);
    const nextSchemaIds = schemaIds.filter((id) => id !== schema.nodeId);
    if (nextSchemaIds.length !== schemaIds.length) {
      await writeSchemaIds(engine, target.occurrenceId, nextSchemaIds);
    }
    changes = await reconcileAndCleanup(engine, target.occurrenceId);
  });

  return {
    target: { nodeId: target.nodeId, occurrenceId: target.occurrenceId },
    schema: { nodeId: schema.nodeId },
    changes,
  };
}

export async function reconcileSchema(
  engine: Engine,
  targetOccurrenceId: string,
): Promise<SchemaChangeResult> {
  const target = await requireCanonicalOccurrence(engine, targetOccurrenceId);
  let changes: DomainChange[] = [];
  await engine.batch(async () => {
    changes = await reconcileAndCleanup(engine, target.occurrenceId);
  });
  return {
    target: { nodeId: target.nodeId, occurrenceId: target.occurrenceId },
    changes,
  };
}

async function reconcileAndCleanup(
  engine: Engine,
  targetOccurrenceId: string,
): Promise<DomainChange[]> {
  return [
    ...(await reconcileTargetSchemas(engine, targetOccurrenceId)),
    ...(await cleanupInactiveManagedChildren(engine, targetOccurrenceId)),
  ];
}
