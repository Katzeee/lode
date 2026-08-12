export type ManagedIdentity = Readonly<{
  parentNodeId: string;
  schemaId: string;
  fieldId: string;
  nodeId: string;
}>;

export function parseManagedIdentity(target: string): ManagedIdentity | null {
  const match = /^(?:managed|managed-occ):v1:([^:]+):([^:]+):([^:]+)$/.exec(target);
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }
  try {
    const parentNodeId = decodeURIComponent(match[1]);
    const schemaId = decodeURIComponent(match[2]);
    const fieldId = decodeURIComponent(match[3]);
    return {
      parentNodeId,
      schemaId,
      fieldId,
      nodeId: managedNodeId(parentNodeId, schemaId, fieldId),
    };
  } catch {
    return null;
  }
}

export function managedNodeId(parentNodeId: string, schemaId: string, fieldId: string): string {
  return managedId(MANAGED_NODE_PREFIX, parentNodeId, schemaId, fieldId);
}

export function managedOccurrenceId(
  parentNodeId: string,
  schemaId: string,
  fieldId: string,
): string {
  return managedId(MANAGED_OCCURRENCE_PREFIX, parentNodeId, schemaId, fieldId);
}

export function mutationTargets(mutation: Mutation): readonly string[] {
  switch (mutation.kind) {
    case "text-splice":
    case "text-mark":
      return [mutation.nodeId];
    case "value-set":
    case "value-unset":
      return [mutation.owner.id];
    case "node-create":
    case "node-delete":
    case "node-restore":
    case "canonical-occurrence-set":
      return [mutation.nodeId];
    case "schema-apply":
    case "schema-remove":
      return [mutation.nodeId, mutation.schemaId];
    case "schema-field-add":
    case "schema-field-remove":
    case "schema-field-configure":
      return [mutation.schemaId, mutation.fieldDefinitionId];
    case "schema-extension-add":
    case "schema-extension-remove":
      return [mutation.schemaId, mutation.baseSchemaId];
    case "field-materialize":
      return [
        mutation.ownerNodeId,
        mutation.fieldDefinitionId,
        mutation.fieldNodeId,
        mutation.fieldOccurrenceId,
      ];
    case "field-initialize":
      return [
        mutation.ownerNodeId,
        mutation.schemaId,
        mutation.fieldDefinitionId,
        ...mutation.values.flatMap((value) => (value.kind === "reference" ? [value.nodeId] : [])),
      ];
    case "occurrence-create":
    case "occurrence-delete":
    case "occurrence-restore":
    case "occurrence-move":
      return [mutation.occurrenceId];
  }
}

function managedId(
  prefix: string,
  parentNodeId: string,
  schemaId: string,
  fieldId: string,
): string {
  return `${prefix}${encodeURIComponent(parentNodeId)}:${encodeURIComponent(schemaId)}:${encodeURIComponent(
    fieldId,
  )}`;
}
import { MANAGED_NODE_PREFIX, MANAGED_OCCURRENCE_PREFIX, type Mutation } from "../fact/index.js";
