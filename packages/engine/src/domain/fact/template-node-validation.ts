import { assertStringArray, requireString } from "./shape-validation-primitives.js";
import type { Mutation } from "./types.js";

export function assertTemplateDetachmentShape(value: Record<string, unknown>): void {
  requireString(value.ownerNodeId, "Template instance owner");
  requireString(value.templateNodeId, "Template Node identity");
  if (value.sourceSchemaIds !== undefined) {
    assertStringArray(value.sourceSchemaIds, "Template source Schemas");
  }
  if (value.sourceApplicationSchemaIds !== undefined) {
    assertStringArray(value.sourceApplicationSchemaIds, "Template source Applications");
  }
  if (value.sourceTemplateItemIds !== undefined) {
    assertStringArray(value.sourceTemplateItemIds, "Template source items");
  }
}

export function validateTemplateDetachment(
  mutation: Extract<Mutation, { kind: "template-node-detach" }>,
  factIdentity: string,
): void {
  requireIdentity(mutation.ownerNodeId, "Template instance owner", factIdentity);
  requireIdentity(mutation.templateNodeId, "Template Node", factIdentity);
  if (!hasValidSourceEvidence(mutation)) {
    throw new Error(`Template detachment lacks unique source evidence: ${factIdentity}`);
  }
  mutation.sourceSchemaIds.forEach((id) =>
    requireIdentity(id, "Template source Schema", factIdentity),
  );
  mutation.sourceApplicationSchemaIds.forEach((id) =>
    requireIdentity(id, "Template source Application", factIdentity),
  );
  mutation.sourceTemplateItemIds.forEach((id) =>
    requireIdentity(id, "Template source item", factIdentity),
  );
}

function hasValidSourceEvidence(
  mutation: Extract<Mutation, { kind: "template-node-detach" }>,
): mutation is typeof mutation & {
  sourceSchemaIds: readonly string[];
  sourceApplicationSchemaIds: readonly string[];
  sourceTemplateItemIds: readonly string[];
} {
  const schemas = mutation.sourceSchemaIds;
  const applications = mutation.sourceApplicationSchemaIds;
  const items = mutation.sourceTemplateItemIds;
  return (
    schemas !== undefined &&
    applications !== undefined &&
    items !== undefined &&
    schemas.length > 0 &&
    schemas.length === applications.length &&
    schemas.length === items.length &&
    new Set(items.map((itemId, index) => `${applications[index]}/${itemId}`)).size === items.length
  );
}

function requireIdentity(value: string, label: string, factIdentity: string): void {
  if (value.length === 0) {
    throw new Error(`${label} identity is empty: ${factIdentity}`);
  }
}
