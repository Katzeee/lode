export const MANAGED_NODE_PREFIX = "managed:v1:";
export const MANAGED_OCCURRENCE_PREFIX = "managed-occ:v1:";
export const INITIALIZED_FIELD_NODE_PREFIX = "initialized-field:v1:";
export const INITIALIZED_FIELD_OCCURRENCE_PREFIX = "initialized-field-occ:v1:";

export function isReservedNodeIdentity(value: string): boolean {
  return value.startsWith(MANAGED_NODE_PREFIX) || value.startsWith(INITIALIZED_FIELD_NODE_PREFIX);
}

export function isReservedOccurrenceIdentity(value: string): boolean {
  return (
    value === "$root" ||
    value.startsWith(MANAGED_OCCURRENCE_PREFIX) ||
    value.startsWith(INITIALIZED_FIELD_OCCURRENCE_PREFIX)
  );
}
