import type { Engine, NodeOccurrence } from "../core/index.js";
import { requireNodeById } from "./lookup.js";
import { ManagedKind, type SchemaProvenance } from "./model/managed-child.js";
import { readSchemaIds } from "./schema-membership.js";
import { isFieldDef, readFieldDefPresence, requireSchema } from "./system-entity.js";
import type { DesiredManagedChild, DesiredManagedChildInput } from "./model/reconcile.js";

export function collectDesiredManagedChildren(
  doc: Engine,
  target: NodeOccurrence,
): DesiredManagedChild[] {
  const desiredByKey = new Map<string, DesiredManagedChild>();

  for (const schemaId of readSchemaIds(doc, target.occurrenceId)) {
    const schema = requireNodeById(doc, schemaId);
    requireSchema(doc, schema, schemaId);

    const schemaCanonical = doc.mustGetOccurrence(doc.getCanonicalOccurrenceId(schema.nodeId));
    for (const schemaChild of doc.getOccurrenceChildren(schemaCanonical.occurrenceId)) {
      const provenance: SchemaProvenance = {
        schemaId,
        schemaChildNodeId: schemaChild.nodeId,
        schemaChildOccurrenceId: schemaChild.occurrenceId,
      };
      if (isFieldDef(doc, schemaChild)) {
        const key = `field:${schemaChild.nodeId}`;
        const createIfMissing = readFieldDefPresence(doc, schemaChild.occurrenceId) !== "optional";
        upsertDesired(desiredByKey, key, {
          key,
          managedKind: ManagedKind.FieldSlot,
          createIfMissing,
          fieldDefNodeId: schemaChild.nodeId,
          provenance,
        });
      } else {
        const key = `template:${schemaChild.nodeId}`;
        upsertDesired(desiredByKey, key, {
          key,
          managedKind: ManagedKind.TemplateRef,
          createIfMissing: true,
          templateNodeId: schemaChild.nodeId,
          provenance,
        });
      }
    }
  }

  return [...desiredByKey.values()];
}

function upsertDesired(
  desiredByKey: Map<string, DesiredManagedChild>,
  key: string,
  incoming: DesiredManagedChildInput,
): void {
  const existing = desiredByKey.get(key);
  if (!existing) {
    desiredByKey.set(key, {
      ...incoming,
      provenance: [incoming.provenance],
    });
    return;
  }
  existing.createIfMissing = existing.createIfMissing || incoming.createIfMissing;
  if (
    !existing.provenance.some(
      (entry) =>
        entry.schemaId === incoming.provenance.schemaId &&
        entry.schemaChildOccurrenceId === incoming.provenance.schemaChildOccurrenceId,
    )
  ) {
    existing.provenance.push(incoming.provenance);
  }
}
