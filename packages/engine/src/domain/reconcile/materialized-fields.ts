import {
  fieldDefinitionEndpointOccurrenceId,
  materializedFieldNodeId,
  materializedFieldOccurrenceId,
  stableStringCompare,
  type FactAction,
} from "../fact/index.js";
import type { MaterializedField } from "./projection-types.js";
import type { MutableOccurrence } from "./projection-state.js";
import { materializedFieldRecord } from "./supertag-relation-records.js";
import { projectTuple } from "./tuple.js";

export function projectMaterializedFields(
  active: readonly FactAction[],
  existingNodeIds: ReadonlySet<string>,
  fieldDefinitionIds: ReadonlySet<string>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
  nodeOwners: Readonly<Record<string, string | null>>,
): Readonly<Record<string, readonly MaterializedField[]>> {
  const fields = collectMaterializedFields(
    active,
    existingNodeIds,
    fieldDefinitionIds,
    occurrences,
    childOccurrences,
    nodeOwners,
  ).sort((left, right) => compareFields(left, right, occurrences, childOccurrences));
  const byOwner = new Map<string, MaterializedField[]>();
  for (const field of fields) {
    const values = byOwner.get(field.ownerNodeId) ?? [];
    values.push(field);
    byOwner.set(field.ownerNodeId, values);
  }
  return materializedFieldRecord(byOwner);
}

function collectMaterializedFields(
  active: readonly FactAction[],
  existingNodeIds: ReadonlySet<string>,
  fieldDefinitionIds: ReadonlySet<string>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
  nodeOwners: Readonly<Record<string, string | null>>,
): MaterializedField[] {
  const fields = new Map<string, MaterializedField>();
  for (const fact of active) {
    const action = fact.action;
    if (action.kind !== "field-materialize") {
      continue;
    }
    const fieldNodeId = materializedFieldNodeId(action.ownerNodeId, action.fieldDefinitionId);
    const fieldOccurrenceId = materializedFieldOccurrenceId(action.ownerNodeId, action.fieldDefinitionId);
    const definitionOccurrenceId = fieldDefinitionEndpointOccurrenceId(fieldOccurrenceId);
    const occurrence = occurrences.get(fieldOccurrenceId);
    const tuple = projectTuple(fieldNodeId, occurrences, childOccurrences, nodeOwners);
    const definitionEndpoint = tuple.endpoints.find((endpoint) => endpoint.occurrenceId === definitionOccurrenceId);
    if (
      !existingNodeIds.has(action.ownerNodeId) ||
      !existingNodeIds.has(fieldNodeId) ||
      !fieldDefinitionIds.has(action.fieldDefinitionId) ||
      occurrence?.nodeId !== fieldNodeId ||
      occurrence.parentNodeId !== action.ownerNodeId ||
      tuple.ownerNodeId !== action.ownerNodeId ||
      definitionEndpoint?.nodeId !== action.fieldDefinitionId ||
      nodeOwners[action.fieldDefinitionId] === fieldNodeId
    ) {
      continue;
    }
    const key = semanticFieldKey(action.ownerNodeId, action.fieldDefinitionId);
    fields.set(key, {
      ownerNodeId: action.ownerNodeId,
      fieldDefinitionId: action.fieldDefinitionId,
      fieldNodeId,
      fieldOccurrenceId,
      definitionOccurrenceId,
      valueOccurrenceIds: (childOccurrences.get(fieldNodeId) ?? []).filter(
        (occurrenceId) => occurrenceId !== definitionOccurrenceId,
      ),
    });
  }
  return [...fields.values()];
}

function compareFields(
  left: MaterializedField,
  right: MaterializedField,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
): number {
  const leftParent = occurrences.get(left.fieldOccurrenceId)?.parentNodeId ?? null;
  const rightParent = occurrences.get(right.fieldOccurrenceId)?.parentNodeId ?? null;
  const sharedParent = leftParent === rightParent ? leftParent : null;
  const placementOrder =
    sharedParent === null
      ? 0
      : (childOccurrences.get(sharedParent)?.indexOf(left.fieldOccurrenceId) ?? -1) -
        (childOccurrences.get(sharedParent)?.indexOf(right.fieldOccurrenceId) ?? -1);
  return (
    placementOrder ||
    stableStringCompare(left.ownerNodeId, right.ownerNodeId) ||
    stableStringCompare(left.fieldDefinitionId, right.fieldDefinitionId)
  );
}

function semanticFieldKey(ownerNodeId: string, fieldDefinitionId: string): string {
  return `${encodeURIComponent(ownerNodeId)}/${encodeURIComponent(fieldDefinitionId)}`;
}
