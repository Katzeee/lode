export const MANAGED_NODE_PREFIX = "managed:v1:";
export const MANAGED_OCCURRENCE_PREFIX = "managed-occ:v1:";

export function isReservedNodeIdentity(value: string): boolean {
  return value.startsWith(MANAGED_NODE_PREFIX);
}

export function isReservedOccurrenceIdentity(value: string): boolean {
  return value === "$root" || value.startsWith(MANAGED_OCCURRENCE_PREFIX);
}
