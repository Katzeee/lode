import {
  TEMPLATE_INSTANCE_NODE_PREFIX,
  TEMPLATE_INSTANCE_OCCURRENCE_PREFIX,
} from "../fact/index.js";

export function templateInstanceNodeId(ownerNodeId: string, templateNodeId: string): string {
  return identity(TEMPLATE_INSTANCE_NODE_PREFIX, ownerNodeId, templateNodeId);
}

export function templateInstanceOccurrenceId(ownerNodeId: string, templateNodeId: string): string {
  return identity(TEMPLATE_INSTANCE_OCCURRENCE_PREFIX, ownerNodeId, templateNodeId);
}

export function templateNodeItemId(schemaId: string, templateNodeId: string): string {
  return `node-template:v1:${encodeURIComponent(schemaId)}:${encodeURIComponent(templateNodeId)}`;
}

function identity(prefix: string, ownerNodeId: string, templateNodeId: string): string {
  return `${prefix}${encodeURIComponent(ownerNodeId)}:${encodeURIComponent(templateNodeId)}`;
}
