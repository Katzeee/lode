import type { MaterializedField } from "./projection-types.js";

export function filterTemplateFields<T extends Readonly<{ fieldDefinitionId: string; fieldNodeId: string }>>(
  values: Readonly<Record<string, readonly T[]>>,
  supertagIds: ReadonlySet<string>,
  fieldDefinitionIds: ReadonlySet<string>,
  activeFieldNodeIds: ReadonlySet<string>,
): Readonly<Record<string, readonly T[]>> {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([supertagId]) => supertagIds.has(supertagId))
      .map(
        ([supertagId, fields]) =>
          [
            supertagId,
            fields.filter(
              (field) => fieldDefinitionIds.has(field.fieldDefinitionId) && activeFieldNodeIds.has(field.fieldNodeId),
            ),
          ] as const,
      )
      .filter(([, fields]) => fields.length > 0),
  );
}

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
