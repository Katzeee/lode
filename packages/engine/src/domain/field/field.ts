import { cascadeRemove, type Engine, type NodeOccurrence, textToDelta } from "../../core/index.js";
import { SystemEntityMeta, type FieldPresence, type FieldType } from "../bundle/system-schema.js";
import type { DomainChange } from "../model/changes.js";
import type {
  FieldAddMode,
  FieldAddResult,
  FieldIdentity,
  FieldSetValuesResult,
  FieldValueInput,
} from "../model/field.js";
import { invalidDomainInput } from "../errors.js";
import {
  assertFieldRemoveAllowed,
  assertNotActiveManagedChild,
} from "../managed/managed-child-policy.js";
import {
  isField,
  markField,
  markFieldDef,
  readFieldDefId,
  requireField,
  requireFieldDef,
} from "../system-entity.js";
import { requireNodeById, requireOccurrence } from "../lookup.js";
import {
  createPlainNode,
  createReference,
  getSemanticChildren,
  moveOccurrence,
  removeOccurrenceOrHardDelete,
} from "../node/node.js";

export async function createFieldDef(
  engine: Engine,
  parentOccurrenceId: string,
  name: string,
  fieldType: FieldType = "plain",
  presence: FieldPresence = "normal",
): Promise<FieldIdentity> {
  const fieldDef = await createPlainNode(engine, parentOccurrenceId);
  await markFieldDef(engine, fieldDef.occurrenceId, fieldType, presence);
  await engine.replaceDeltas(fieldDef.occurrenceId, textToDelta(name));
  const updated = await engine.mustGetOccurrence(fieldDef.occurrenceId);
  return { nodeId: updated.nodeId, occurrenceId: updated.occurrenceId };
}

export async function setFieldDefType(
  engine: Engine,
  fieldDefNodeId: string,
  fieldType: FieldType,
): Promise<void> {
  const node = await requireNodeById(engine, fieldDefNodeId);
  await requireFieldDef(engine, node, fieldDefNodeId);
  await engine.setEntityMeta(node.occurrenceId, SystemEntityMeta.FieldType, fieldType);
}

export async function setFieldDefPresence(
  engine: Engine,
  fieldDefNodeId: string,
  presence: FieldPresence,
): Promise<void> {
  const node = await requireNodeById(engine, fieldDefNodeId);
  await requireFieldDef(engine, node, fieldDefNodeId);
  await engine.setEntityMeta(node.occurrenceId, SystemEntityMeta.Presence, presence);
}

export async function addField(
  engine: Engine,
  targetOccurrenceId: string,
  fieldDefNodeId: string,
  mode: FieldAddMode = "reuseExisting",
): Promise<FieldAddResult> {
  const target = await engine.getOccurrence(targetOccurrenceId);
  if (!target) {
    invalidDomainInput(`Occurrence not found: ${targetOccurrenceId}`, {
      reason: "occurrence_not_found",
      occurrenceId: targetOccurrenceId,
    });
  }

  const fieldDef = await requireNodeById(engine, fieldDefNodeId);
  await requireFieldDef(engine, fieldDef, fieldDefNodeId);

  const children = await getSemanticChildren(engine, target.occurrenceId);
  let existing: NodeOccurrence | undefined;
  for (const child of children) {
    if (
      (await isField(engine, child)) &&
      (await readFieldDefId(engine, child)) === fieldDefNodeId
    ) {
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

  const field = await createPlainNode(engine, target.occurrenceId);
  await markField(engine, field.occurrenceId, fieldDefNodeId);
  return { nodeId: field.nodeId, occurrenceId: field.occurrenceId, created: true };
}

export async function setFieldValues(
  engine: Engine,
  fieldOccurrenceId: string,
  values: FieldValueInput[],
): Promise<FieldSetValuesResult> {
  const field = await requireFieldNode(engine, fieldOccurrenceId);
  const changes: DomainChange[] = [];
  const moveOccurrenceIds = new Set<string>();

  for (const value of values) {
    if (value.type === "text") {
      continue;
    }
    if (value.type === "ref") {
      await requireNodeById(engine, value.targetNodeId);
      continue;
    }
    if (moveOccurrenceIds.has(value.occurrenceId)) {
      invalidDomainInput(`Duplicate move occurrenceId: ${value.occurrenceId}`, {
        reason: "duplicate_move_occ",
        occurrenceId: value.occurrenceId,
      });
    }
    moveOccurrenceIds.add(value.occurrenceId);
    await assertNotActiveManagedChild(engine, value.occurrenceId);
  }

  await engine.batch(async () => {
    const existingValues = await getSemanticChildren(engine, field.occurrenceId);
    for (const valueNode of existingValues) {
      if (moveOccurrenceIds.has(valueNode.occurrenceId)) {
        continue;
      }
      await removeOccurrenceOrHardDelete(engine, valueNode.occurrenceId);
      changes.push({
        kind: "fieldValue",
        reason: "deleted",
        nodeId: valueNode.nodeId,
        occurrenceId: valueNode.occurrenceId,
      });
    }

    for (const [index, value] of values.entries()) {
      if (value.type === "text") {
        const textNode = await createPlainNode(engine, field.occurrenceId, index);
        await engine.replaceDeltas(textNode.occurrenceId, [{ insert: value.text }]);
        changes.push({
          kind: "fieldValue",
          reason: "created",
          nodeId: textNode.nodeId,
          occurrenceId: textNode.occurrenceId,
        });
        continue;
      }
      if (value.type === "ref") {
        const ref = await createReference(engine, value.targetNodeId, field.occurrenceId, index);
        changes.push({
          kind: "fieldValue",
          reason: "created",
          nodeId: ref.nodeId,
          occurrenceId: ref.occurrenceId,
        });
        continue;
      }
      await moveOccurrence(engine, value.occurrenceId, field.occurrenceId, index);
      const moved = await requireOccurrence(engine, value.occurrenceId);
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

export async function removeField(engine: Engine, fieldOccurrenceId: string): Promise<void> {
  const field = await requireFieldNode(engine, fieldOccurrenceId);
  await assertFieldRemoveAllowed(engine, field);
  // Bare cascade (no managed-child guard): a field IS an active managed child, so the product
  // `removeOccurrenceOrHardDelete` would reject it. Field lifecycle carries its own authorization
  // (`assertFieldRemoveAllowed` — allows optional fields, blocks required ones) and then removes
  // directly through the core cascade.
  await cascadeRemove(engine, field.occurrenceId);
}

async function requireFieldNode(engine: Engine, occurrenceId: string): Promise<NodeOccurrence> {
  const node = await requireOccurrence(engine, occurrenceId);
  await requireField(engine, node, occurrenceId);
  return node;
}
