import { type Engine, type NodeOccurrence, textToDelta } from "../core/index.js";
import { SystemEntityMeta, type FieldPresence, type FieldType } from "../bundle/system-schema.js";
import type { DomainChange } from "./model/changes.js";
import type {
  FieldAddMode,
  FieldAddResult,
  FieldIdentity,
  FieldSetValuesResult,
  FieldValueInput,
} from "./model/field.js";
import { invalidDomainInput } from "./errors.js";
import { assertFieldRemoveAllowed, assertNotActiveManagedChild } from "./managed-child-policy.js";
import {
  isField,
  markField,
  markFieldDef,
  readFieldDefId,
  requireField,
  requireFieldDef,
} from "./system-entity.js";
import { requireNodeById, requireOccurrence } from "./lookup.js";
import {
  createPlainNode,
  createReference,
  getSemanticChildren,
  moveOccurrence,
  removeOccurrenceOrHardDelete,
} from "./node.js";

export async function createFieldDef(
  doc: Engine,
  parentOccurrenceId: string,
  name: string,
  fieldType: FieldType = "plain",
  presence: FieldPresence = "normal",
): Promise<FieldIdentity> {
  const fieldDef = await createPlainNode(doc, parentOccurrenceId);
  await markFieldDef(doc, fieldDef.occurrenceId, fieldType, presence);
  await doc.replaceDeltas(fieldDef.occurrenceId, textToDelta(name));
  const updated = await doc.mustGetOccurrence(fieldDef.occurrenceId);
  return { nodeId: updated.nodeId, occurrenceId: updated.occurrenceId };
}

export async function setFieldDefType(
  doc: Engine,
  fieldDefNodeId: string,
  fieldType: FieldType,
): Promise<void> {
  const node = await requireNodeById(doc, fieldDefNodeId);
  await requireFieldDef(doc, node, fieldDefNodeId);
  await doc.setEntityMeta(node.occurrenceId, SystemEntityMeta.FieldType, fieldType);
}

export async function setFieldDefPresence(
  doc: Engine,
  fieldDefNodeId: string,
  presence: FieldPresence,
): Promise<void> {
  const node = await requireNodeById(doc, fieldDefNodeId);
  await requireFieldDef(doc, node, fieldDefNodeId);
  await doc.setEntityMeta(node.occurrenceId, SystemEntityMeta.Presence, presence);
}

export async function addField(
  doc: Engine,
  targetOccurrenceId: string,
  fieldDefNodeId: string,
  mode: FieldAddMode = "reuseExisting",
): Promise<FieldAddResult> {
  const target = await doc.getOccurrence(targetOccurrenceId);
  if (!target) {
    invalidDomainInput(`Occurrence not found: ${targetOccurrenceId}`, {
      reason: "occurrence_not_found",
      occurrenceId: targetOccurrenceId,
    });
  }

  const fieldDef = await requireNodeById(doc, fieldDefNodeId);
  await requireFieldDef(doc, fieldDef, fieldDefNodeId);

  const children = await getSemanticChildren(doc, target.occurrenceId);
  let existing: NodeOccurrence | undefined;
  for (const child of children) {
    if ((await isField(doc, child)) && (await readFieldDefId(doc, child)) === fieldDefNodeId) {
      existing = child;
      break;
    }
  }
  if (existing) {
    if (mode === "createOnly") {
      invalidDomainInput(`Field already exists for fieldDef: ${fieldDefNodeId}`, {
        reason: "field_exists",
        fieldDefNodeId,
        targetOccurrenceId,
        occurrenceId: existing.occurrenceId,
      });
    }
    return { nodeId: existing.nodeId, occurrenceId: existing.occurrenceId, created: false };
  }

  const field = await createPlainNode(doc, target.occurrenceId);
  await markField(doc, field.occurrenceId, fieldDefNodeId);
  return { nodeId: field.nodeId, occurrenceId: field.occurrenceId, created: true };
}

export async function setFieldValues(
  doc: Engine,
  fieldOccurrenceId: string,
  values: FieldValueInput[],
): Promise<FieldSetValuesResult> {
  const field = await requireFieldNode(doc, fieldOccurrenceId);
  const changes: DomainChange[] = [];
  const moveOccurrenceIds = new Set<string>();

  for (const value of values) {
    if (value.type === "text") {
      continue;
    }
    if (value.type === "ref") {
      await requireNodeById(doc, value.targetNodeId);
      continue;
    }
    if (moveOccurrenceIds.has(value.occurrenceId)) {
      invalidDomainInput(`Duplicate move occurrenceId: ${value.occurrenceId}`, {
        reason: "duplicate_move_occ",
        occurrenceId: value.occurrenceId,
      });
    }
    moveOccurrenceIds.add(value.occurrenceId);
    await assertNotActiveManagedChild(doc, value.occurrenceId);
  }

  await doc.batch(async () => {
    const existingValues = await getSemanticChildren(doc, field.occurrenceId);
    for (const valueNode of existingValues) {
      if (moveOccurrenceIds.has(valueNode.occurrenceId)) {
        continue;
      }
      await removeOccurrenceOrHardDelete(doc, valueNode.occurrenceId);
      changes.push({
        kind: "fieldValue",
        reason: "deleted",
        nodeId: valueNode.nodeId,
        occurrenceId: valueNode.occurrenceId,
      });
    }

    for (const [index, value] of values.entries()) {
      if (value.type === "text") {
        const textNode = await createPlainNode(doc, field.occurrenceId, index);
        await doc.replaceDeltas(textNode.occurrenceId, [{ insert: value.text }]);
        changes.push({
          kind: "fieldValue",
          reason: "created",
          nodeId: textNode.nodeId,
          occurrenceId: textNode.occurrenceId,
        });
        continue;
      }
      if (value.type === "ref") {
        const ref = await createReference(doc, value.targetNodeId, field.occurrenceId, index);
        changes.push({
          kind: "fieldValue",
          reason: "created",
          nodeId: ref.nodeId,
          occurrenceId: ref.occurrenceId,
        });
        continue;
      }
      await moveOccurrence(doc, value.occurrenceId, field.occurrenceId, index);
      const moved = await requireOccurrence(doc, value.occurrenceId);
      changes.push({
        kind: "fieldValue",
        reason: "moved",
        nodeId: moved.nodeId,
        occurrenceId: moved.occurrenceId,
      });
    }
  });

  return { field: { nodeId: field.nodeId, occurrenceId: field.occurrenceId }, changes };
}

export async function removeField(doc: Engine, fieldOccurrenceId: string): Promise<void> {
  const field = await requireFieldNode(doc, fieldOccurrenceId);
  await assertFieldRemoveAllowed(doc, field);
  await removeOccurrenceOrHardDelete(doc, field.occurrenceId);
}

async function requireFieldNode(doc: Engine, occurrenceId: string): Promise<NodeOccurrence> {
  const node = await requireOccurrence(doc, occurrenceId);
  await requireField(doc, node, occurrenceId);
  return node;
}
