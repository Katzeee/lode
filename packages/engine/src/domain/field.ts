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

export function createFieldDef(
  doc: Engine,
  parentOccurrenceId: string,
  name: string,
  fieldType: FieldType = "plain",
  presence: FieldPresence = "normal",
): FieldIdentity {
  const fieldDef = createPlainNode(doc, parentOccurrenceId);
  markFieldDef(doc, fieldDef.occurrenceId, fieldType, presence);
  doc.replaceDeltas(fieldDef.occurrenceId, textToDelta(name));
  const updated = doc.mustGetOccurrence(fieldDef.occurrenceId);
  return { nodeId: updated.nodeId, occurrenceId: updated.occurrenceId };
}

export function setFieldDefType(doc: Engine, fieldDefNodeId: string, fieldType: FieldType): void {
  const node = requireNodeById(doc, fieldDefNodeId);
  requireFieldDef(doc, node, fieldDefNodeId);
  doc.setEntityMeta(node.occurrenceId, SystemEntityMeta.FieldType, fieldType);
}

export function setFieldDefPresence(
  doc: Engine,
  fieldDefNodeId: string,
  presence: FieldPresence,
): void {
  const node = requireNodeById(doc, fieldDefNodeId);
  requireFieldDef(doc, node, fieldDefNodeId);
  doc.setEntityMeta(node.occurrenceId, SystemEntityMeta.Presence, presence);
}

export function addField(
  doc: Engine,
  targetOccurrenceId: string,
  fieldDefNodeId: string,
  mode: FieldAddMode = "reuseExisting",
): FieldAddResult {
  const target = doc.getOccurrence(targetOccurrenceId);
  if (!target) {
    invalidDomainInput(`Occurrence not found: ${targetOccurrenceId}`, {
      reason: "occurrence_not_found",
      occurrenceId: targetOccurrenceId,
    });
  }

  const fieldDef = requireNodeById(doc, fieldDefNodeId);
  requireFieldDef(doc, fieldDef, fieldDefNodeId);

  const existing = getSemanticChildren(doc, target.occurrenceId).find(
    (child) => isField(doc, child) && readFieldDefId(doc, child) === fieldDefNodeId,
  );
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

  const field = createPlainNode(doc, target.occurrenceId);
  markField(doc, field.occurrenceId, fieldDefNodeId);
  return { nodeId: field.nodeId, occurrenceId: field.occurrenceId, created: true };
}

export function setFieldValues(
  doc: Engine,
  fieldOccurrenceId: string,
  values: FieldValueInput[],
): FieldSetValuesResult {
  const field = requireFieldNode(doc, fieldOccurrenceId);
  const changes: DomainChange[] = [];
  const moveOccurrenceIds = new Set<string>();

  for (const value of values) {
    if (value.type === "text") {
      continue;
    }
    if (value.type === "ref") {
      requireNodeById(doc, value.targetNodeId);
      continue;
    }
    if (moveOccurrenceIds.has(value.occurrenceId)) {
      invalidDomainInput(`Duplicate move occurrenceId: ${value.occurrenceId}`, {
        reason: "duplicate_move_occurrence",
        occurrenceId: value.occurrenceId,
      });
    }
    moveOccurrenceIds.add(value.occurrenceId);
    assertNotActiveManagedChild(doc, value.occurrenceId);
  }

  doc.batch(() => {
    const existingValues = getSemanticChildren(doc, field.occurrenceId);
    for (const valueNode of existingValues) {
      if (moveOccurrenceIds.has(valueNode.occurrenceId)) {
        continue;
      }
      removeOccurrenceOrHardDelete(doc, valueNode.occurrenceId);
      changes.push({
        kind: "fieldValue",
        reason: "deleted",
        nodeId: valueNode.nodeId,
        occurrenceId: valueNode.occurrenceId,
      });
    }

    for (const [index, value] of values.entries()) {
      if (value.type === "text") {
        const textNode = createPlainNode(doc, field.occurrenceId, index);
        doc.replaceDeltas(textNode.occurrenceId, [{ insert: value.text }]);
        changes.push({
          kind: "fieldValue",
          reason: "created",
          nodeId: textNode.nodeId,
          occurrenceId: textNode.occurrenceId,
        });
        continue;
      }
      if (value.type === "ref") {
        const ref = createReference(doc, value.targetNodeId, field.occurrenceId, index);
        changes.push({
          kind: "fieldValue",
          reason: "created",
          nodeId: ref.nodeId,
          occurrenceId: ref.occurrenceId,
        });
        continue;
      }
      moveOccurrence(doc, value.occurrenceId, field.occurrenceId, index);
      const moved = requireOccurrence(doc, value.occurrenceId);
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

export function removeField(doc: Engine, fieldOccurrenceId: string): void {
  const field = requireFieldNode(doc, fieldOccurrenceId);
  assertFieldRemoveAllowed(doc, field);
  removeOccurrenceOrHardDelete(doc, field.occurrenceId);
}

function requireFieldNode(doc: Engine, occurrenceId: string): NodeOccurrence {
  const node = requireOccurrence(doc, occurrenceId);
  requireField(doc, node, occurrenceId);
  return node;
}
