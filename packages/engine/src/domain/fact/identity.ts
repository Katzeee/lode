export const INITIALIZED_FIELD_NODE_PREFIX = "initialized-field:v1:";
export const INITIALIZED_FIELD_OCCURRENCE_PREFIX = "initialized-field-occ:v1:";
export const TEMPLATE_INSTANCE_NODE_PREFIX = "template-instance:v1:";
export const TEMPLATE_INSTANCE_OCCURRENCE_PREFIX = "template-instance-occ:v1:";

export function initializedFieldNodeId(ownerNodeId: string, fieldDefinitionId: string): string {
  return `${INITIALIZED_FIELD_NODE_PREFIX}${encodeURIComponent(ownerNodeId)}:${encodeURIComponent(fieldDefinitionId)}`;
}

export function initializedFieldOccurrenceId(ownerNodeId: string, fieldDefinitionId: string): string {
  return `${INITIALIZED_FIELD_OCCURRENCE_PREFIX}${encodeURIComponent(ownerNodeId)}:${encodeURIComponent(fieldDefinitionId)}`;
}

export function initializedValueNodeId(fieldNodeId: string, index: number): string {
  return `${fieldNodeId}:value:${index}`;
}

export function initializedValueOccurrenceId(fieldOccurrenceId: string, index: number): string {
  return `${fieldOccurrenceId}:value:${index}`;
}

export function templateInstanceNodeId(ownerNodeId: string, templateNodeId: string): string {
  return identity(TEMPLATE_INSTANCE_NODE_PREFIX, ownerNodeId, templateNodeId);
}

export function templateInstanceOccurrenceId(ownerNodeId: string, templateNodeId: string): string {
  return identity(TEMPLATE_INSTANCE_OCCURRENCE_PREFIX, ownerNodeId, templateNodeId);
}

function identity(prefix: string, ownerNodeId: string, templateNodeId: string): string {
  return `${prefix}${encodeURIComponent(ownerNodeId)}:${encodeURIComponent(templateNodeId)}`;
}
