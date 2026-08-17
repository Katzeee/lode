import type { MaterializedField } from "./projection-types.js";

export function filterRecordOwners<T>(
  values: Readonly<Record<string, readonly T[]>>,
  ownerIds: ReadonlySet<string>,
): Readonly<Record<string, readonly T[]>> {
  return Object.fromEntries(Object.entries(values).filter(([ownerId]) => ownerIds.has(ownerId)));
}

export function filterMaterializedFields(
  values: Readonly<Record<string, readonly MaterializedField[]>>,
  fieldDefinitionIds: ReadonlySet<string>,
): Readonly<Record<string, readonly MaterializedField[]>> {
  return Object.fromEntries(
    Object.entries(values)
      .map(
        ([ownerNodeId, fields]) =>
          [ownerNodeId, fields.filter((field) => fieldDefinitionIds.has(field.fieldDefinitionId))] as const,
      )
      .filter(([, fields]) => fields.length > 0),
  );
}
