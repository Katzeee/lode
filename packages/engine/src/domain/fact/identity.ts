export const INITIALIZED_FIELD_NODE_PREFIX = "initialized-field:v1:";
export const INITIALIZED_FIELD_OCCURRENCE_PREFIX = "initialized-field-occ:v1:";
export const TEMPLATE_INSTANCE_NODE_PREFIX = "template-instance:v1:";
export const TEMPLATE_INSTANCE_OCCURRENCE_PREFIX = "template-instance-occ:v1:";

export function isReservedNodeIdentity(value: string): boolean {
  return (
    value.startsWith(INITIALIZED_FIELD_NODE_PREFIX) ||
    value.startsWith(TEMPLATE_INSTANCE_NODE_PREFIX)
  );
}

export function isReservedOccurrenceIdentity(value: string): boolean {
  return (
    value === "$root" ||
    value.startsWith(INITIALIZED_FIELD_OCCURRENCE_PREFIX) ||
    value.startsWith(TEMPLATE_INSTANCE_OCCURRENCE_PREFIX)
  );
}
