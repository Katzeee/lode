import { type Engine, textToDelta } from "../../core/index.js";
import { SystemEntityMeta, SystemKind } from "../bundle/system-schema.js";
import type { DomainChange } from "../model/changes.js";
import type { SchemaChangeResult, SchemaIdentity } from "../model/schema.js";
import { requireCanonicalOccurrence, requireNodeById, requireOccurrence } from "../lookup.js";
import { readSchemaIds, writeSchemaIds } from "./schema-membership.js";
import { requireSchema } from "../system-entity.js";
import { createPlainNode } from "../node/node.js";
import { cleanupInactiveManagedChildren, reconcileTargetSchemas } from "./schema-reconcile.js";

export async function createSchema(
  engine: Engine,
  name: string,
  parentOccurrenceId: string,
): Promise<SchemaIdentity> {
  await requireOccurrence(engine, parentOccurrenceId);
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
  return changeSchemaMembership(engine, targetOccurrenceId, schemaNodeId, (ids, id) =>
    ids.includes(id) ? null : [...ids, id],
  );
}

export async function removeSchema(
  engine: Engine,
  targetOccurrenceId: string,
  schemaNodeId: string,
): Promise<SchemaChangeResult> {
  return changeSchemaMembership(engine, targetOccurrenceId, schemaNodeId, (ids, id) =>
    ids.includes(id) ? ids.filter((x) => x !== id) : null,
  );
}

/** Add or remove a schema from a target's schema list. `update` returns the next id list, or null to
 *  skip the write (the membership is already in the desired state). The resolve-target / require-schema
 *  / batch / reconcile tail is identical for apply and remove, so it lives here once. */
async function changeSchemaMembership(
  engine: Engine,
  targetOccurrenceId: string,
  schemaNodeId: string,
  update: (schemaIds: string[], schemaNodeId: string) => string[] | null,
): Promise<SchemaChangeResult> {
  const target = await requireCanonicalOccurrence(engine, targetOccurrenceId);
  const schema = await requireNodeById(engine, schemaNodeId);
  await requireSchema(engine, schema, schemaNodeId);

  let changes: DomainChange[] = [];
  await engine.batch(async () => {
    const schemaIds = await readSchemaIds(engine, target.occurrenceId);
    const next = update(schemaIds, schema.nodeId);
    if (next !== null) {
      await writeSchemaIds(engine, target.occurrenceId, next);
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
