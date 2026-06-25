import { type Engine, textToDelta } from "../core/index.js";
import type { DomainChange } from "./changes.js";
import { invalidDomainInput } from "./errors.js";
import { requireCanonicalOccurrence, requireNodeById } from "./lookup.js";
import { readSchemaIds, writeSchemaIds } from "./schema-membership.js";
import { SystemEntityMeta, SystemKind, requireSchema } from "./system-entity.js";
import { createPlainNode } from "./node.js";
import { cleanupInactiveManagedChildren, reconcileTargetSchemas } from "./schema-reconcile.js";

export type SchemaIdentity = {
  nodeId: string;
  occurrenceId: string;
};

export type SchemaChangeResult = {
  target: SchemaIdentity;
  schema?: { nodeId: string };
  changes: DomainChange[];
};

export function createSchema(
  doc: Engine,
  name: string,
  parentOccurrenceId?: string | null,
): SchemaIdentity {
  if (parentOccurrenceId != null && !doc.getOccurrence(parentOccurrenceId)) {
    invalidDomainInput(`Occurrence not found: ${parentOccurrenceId}`, {
      reason: "occurrence_not_found",
      occurrenceId: parentOccurrenceId,
    });
  }
  const schema = createPlainNode(doc, parentOccurrenceId ?? null);
  doc.setEntityMeta(schema.occurrenceId, SystemEntityMeta.SystemKind, SystemKind.Schema);
  doc.replaceDeltas(schema.occurrenceId, textToDelta(name));
  return { nodeId: schema.nodeId, occurrenceId: schema.occurrenceId };
}

export function applySchema(
  doc: Engine,
  targetOccurrenceId: string,
  schemaNodeId: string,
): SchemaChangeResult {
  const target = requireCanonicalOccurrence(doc, targetOccurrenceId);
  const schema = requireNodeById(doc, schemaNodeId);
  requireSchema(doc, schema, schemaNodeId);

  let changes: DomainChange[] = [];
  doc.batch(() => {
    const schemaIds = readSchemaIds(doc, target.occurrenceId);
    if (!schemaIds.includes(schema.nodeId)) {
      writeSchemaIds(doc, target.occurrenceId, [...schemaIds, schema.nodeId]);
    }
    changes = reconcileAndCleanup(doc, target.occurrenceId);
  });

  return {
    target: { nodeId: target.nodeId, occurrenceId: target.occurrenceId },
    schema: { nodeId: schema.nodeId },
    changes,
  };
}

export function removeSchema(
  doc: Engine,
  targetOccurrenceId: string,
  schemaNodeId: string,
): SchemaChangeResult {
  const target = requireCanonicalOccurrence(doc, targetOccurrenceId);
  const schema = requireNodeById(doc, schemaNodeId);
  requireSchema(doc, schema, schemaNodeId);

  let changes: DomainChange[] = [];
  doc.batch(() => {
    const schemaIds = readSchemaIds(doc, target.occurrenceId);
    const nextSchemaIds = schemaIds.filter((id) => id !== schema.nodeId);
    if (nextSchemaIds.length !== schemaIds.length) {
      writeSchemaIds(doc, target.occurrenceId, nextSchemaIds);
    }
    changes = reconcileAndCleanup(doc, target.occurrenceId);
  });

  return {
    target: { nodeId: target.nodeId, occurrenceId: target.occurrenceId },
    schema: { nodeId: schema.nodeId },
    changes,
  };
}

export function reconcileSchema(doc: Engine, targetOccurrenceId: string): SchemaChangeResult {
  const target = requireCanonicalOccurrence(doc, targetOccurrenceId);
  let changes: DomainChange[] = [];
  doc.batch(() => {
    changes = reconcileAndCleanup(doc, target.occurrenceId);
  });
  return {
    target: { nodeId: target.nodeId, occurrenceId: target.occurrenceId },
    changes,
  };
}

function reconcileAndCleanup(doc: Engine, targetOccurrenceId: string): DomainChange[] {
  return [
    ...reconcileTargetSchemas(doc, targetOccurrenceId),
    ...cleanupInactiveManagedChildren(doc, targetOccurrenceId),
  ];
}
