import {
  canonicalJson,
  fieldContentDeletionOccurrenceId,
  type FieldContentDeletionMutation,
  type Mutation,
} from "../fact/index.js";

export type TemplateNodeMutation = Extract<
  Mutation,
  { kind: "schema-template-node-add" | "schema-template-node-remove" | "template-node-detach" }
>;

export function isTemplateNodeMutation(mutation: Mutation): mutation is TemplateNodeMutation {
  return mutation.kind.includes("template-node");
}

export function templateNodeScopes(mutation: TemplateNodeMutation): readonly string[] {
  if (
    mutation.kind === "schema-template-node-add" ||
    mutation.kind === "schema-template-node-remove"
  ) {
    return [
      canonicalJson(["schema-template", mutation.schemaId]),
      associatedNode(mutation.schemaId),
      associatedNode(mutation.templateNodeId),
    ];
  }
  return [
    canonicalJson(["template-detachment", mutation.ownerNodeId, mutation.templateNodeId]),
    associatedNode(mutation.ownerNodeId),
    associatedNode(mutation.templateNodeId),
  ];
}

export function fieldContentDeletionScopes(
  mutation: FieldContentDeletionMutation,
): readonly string[] {
  return [
    canonicalJson(["field-content", mutation.ownerNodeId, mutation.fieldDefinitionId]),
    associatedNode(mutation.ownerNodeId),
    associatedNode(mutation.fieldDefinitionId),
    mutation.kind === "field-value-delete"
      ? canonicalJson(["associated-occurrence", fieldContentDeletionOccurrenceId(mutation)])
      : associatedNode(mutation.fieldNodeId),
  ];
}

function associatedNode(nodeId: string): string {
  return canonicalJson(["associated-node", nodeId]);
}
