import { type Engine, textToDelta } from "../../core/index.js";
import { SystemEntityMeta, SystemKind } from "../../bundle/system-schema.js";
import type { DomainChange } from "../model/changes.js";
import type { SchemaChangeResult, SchemaIdentity } from "../model/schema.js";
import { invalidDomainInput } from "../errors.js";
import { requireCanonicalOccurrence, requireNodeById } from "../lookup.js";
import { readSchemaIds, writeSchemaIds } from "./schema-membership.js";
import { requireSchema } from "../system-entity.js";
import { createPlainNode } from "../node/node.js";
import { cleanupInactiveManagedChildren, reconcileTargetSchemas } from "./schema-reconcile.js";

export async function createSchema(
  doc: Engine,
  name: string,
  parentOccurrenceId: string,
): Promise<SchemaIdentity> {
  if (!(await doc.getOccurrence(parentOccurrenceId))) {
    invalidDomainInput(`Occurrence not found: ${parentOccurrenceId}`, {
      reason: "occurrence_not_found",
      occurrenceId: parentOccurrenceId,
    });
  }
  const schema = await createPlainNode(doc, parentOccurrenceId);
  await doc.setEntityMeta(schema.occurrenceId, SystemEntityMeta.SystemKind, SystemKind.Schema);
  await doc.replaceDeltas(schema.occurrenceId, textToDelta(name));
  return { nodeId: schema.nodeId, occurrenceId: schema.occurrenceId };
}

export async function applySchema(
  doc: Engine,
  targetOccurrenceId: string,
  schemaNodeId: string,
): Promise<SchemaChangeResult> {
  const target = await requireCanonicalOccurrence(doc, targetOccurrenceId);
  const schema = await requireNodeById(doc, schemaNodeId);
  await requireSchema(doc, schema, schemaNodeId);

  let changes: DomainChange[] = [];
  await doc.batch(async () => {
    const schemaIds = await readSchemaIds(doc, target.occurrenceId);
    if (!schemaIds.includes(schema.nodeId)) {
      await writeSchemaIds(doc, target.occurrenceId, [...schemaIds, schema.nodeId]);
    }
    changes = await reconcileAndCleanup(doc, target.occurrenceId);
  });

  return {
    target: { nodeId: target.nodeId, occurrenceId: target.occurrenceId },
    schema: { nodeId: schema.nodeId },
    changes,
  };
}

export async function removeSchema(
  doc: Engine,
  targetOccurrenceId: string,
  schemaNodeId: string,
): Promise<SchemaChangeResult> {
  const target = await requireCanonicalOccurrence(doc, targetOccurrenceId);
  const schema = await requireNodeById(doc, schemaNodeId);
  await requireSchema(doc, schema, schemaNodeId);

  let changes: DomainChange[] = [];
  await doc.batch(async () => {
    const schemaIds = await readSchemaIds(doc, target.occurrenceId);
    const nextSchemaIds = schemaIds.filter((id) => id !== schema.nodeId);
    if (nextSchemaIds.length !== schemaIds.length) {
      await writeSchemaIds(doc, target.occurrenceId, nextSchemaIds);
    }
    changes = await reconcileAndCleanup(doc, target.occurrenceId);
  });

  return {
    target: { nodeId: target.nodeId, occurrenceId: target.occurrenceId },
    schema: { nodeId: schema.nodeId },
    changes,
  };
}

export async function reconcileSchema(
  doc: Engine,
  targetOccurrenceId: string,
): Promise<SchemaChangeResult> {
  const target = await requireCanonicalOccurrence(doc, targetOccurrenceId);
  let changes: DomainChange[] = [];
  await doc.batch(async () => {
    changes = await reconcileAndCleanup(doc, target.occurrenceId);
  });
  return {
    target: { nodeId: target.nodeId, occurrenceId: target.occurrenceId },
    changes,
  };
}

async function reconcileAndCleanup(
  doc: Engine,
  targetOccurrenceId: string,
): Promise<DomainChange[]> {
  return [
    ...(await reconcileTargetSchemas(doc, targetOccurrenceId)),
    ...(await cleanupInactiveManagedChildren(doc, targetOccurrenceId)),
  ];
}
