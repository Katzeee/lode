import {
  assertObject,
  assertOneOf,
  assertKeys,
  assertNullableString,
  assertStringArray,
  requireString,
} from "../../shape-validation/index.js";
import type { Mutation } from "./types.js";
import { templateInstanceNodeId, templateInstanceOccurrenceId } from "./identity.js";

export function assertTemplateDetachmentShape(value: Record<string, unknown>): void {
  requireString(value.ownerNodeId, "Template instance owner");
  requireString(value.templateNodeId, "Template Node identity");
  requireString(value.instanceNodeId, "Detached Template instance Node");
  requireString(value.instanceOccurrenceId, "Detached Template instance Occurrence");
  assertObject(value.anchor, "Detached Template instance anchor");
  assertKeys(value.anchor, ["after", "before", "affinity", "fallback"], "Detached Template instance anchor");
  assertNullableString(value.anchor.after, "anchor after");
  assertNullableString(value.anchor.before, "anchor before");
  assertOneOf(value.anchor.affinity, ["after", "before"], "anchor affinity");
  assertOneOf(value.anchor.fallback, ["start", "end"], "anchor fallback");
  if (value.sourceSupertagIds !== undefined) {
    assertStringArray(value.sourceSupertagIds, "Template source Supertags");
  }
  if (value.sourceApplicationSupertagIds !== undefined) {
    assertStringArray(value.sourceApplicationSupertagIds, "Template source Applications");
  }
  if (value.sourceTemplateOccurrenceIds !== undefined) {
    assertStringArray(value.sourceTemplateOccurrenceIds, "Template source Occurrences");
  }
}

export function validateTemplateDetachment(
  mutation: Extract<Mutation, { kind: "template-node-detach" }>,
  factIdentity: string,
): void {
  requireIdentity(mutation.ownerNodeId, "Template instance owner", factIdentity);
  requireIdentity(mutation.templateNodeId, "Template Node", factIdentity);
  requireIdentity(mutation.instanceNodeId, "Detached Template instance Node", factIdentity);
  requireIdentity(mutation.instanceOccurrenceId, "Detached Template instance Occurrence", factIdentity);
  if (mutation.instanceNodeId !== templateInstanceNodeId(mutation.ownerNodeId, mutation.templateNodeId)) {
    throw new Error(`Template detachment Node identity is not canonical: ${factIdentity}`);
  }
  if (mutation.instanceOccurrenceId !== templateInstanceOccurrenceId(mutation.ownerNodeId, mutation.templateNodeId)) {
    throw new Error(`Template detachment Occurrence identity is not canonical: ${factIdentity}`);
  }
  if (!hasValidSourceEvidence(mutation)) {
    throw new Error(`Template detachment lacks unique source evidence: ${factIdentity}`);
  }
  mutation.sourceSupertagIds.forEach((id) => requireIdentity(id, "Template source Supertag", factIdentity));
  mutation.sourceApplicationSupertagIds.forEach((id) =>
    requireIdentity(id, "Template source Application", factIdentity),
  );
  mutation.sourceTemplateOccurrenceIds.forEach((id) => requireIdentity(id, "Template source Occurrence", factIdentity));
}

function hasValidSourceEvidence(
  mutation: Extract<Mutation, { kind: "template-node-detach" }>,
): mutation is typeof mutation & {
  sourceSupertagIds: readonly string[];
  sourceApplicationSupertagIds: readonly string[];
  sourceTemplateOccurrenceIds: readonly string[];
} {
  const supertags = mutation.sourceSupertagIds;
  const applications = mutation.sourceApplicationSupertagIds;
  const items = mutation.sourceTemplateOccurrenceIds;
  return (
    supertags !== undefined &&
    applications !== undefined &&
    items !== undefined &&
    supertags.length > 0 &&
    supertags.length === applications.length &&
    supertags.length === items.length &&
    new Set(items.map((itemId, index) => `${applications[index]}/${itemId}`)).size === items.length
  );
}

function requireIdentity(value: string, label: string, factIdentity: string): void {
  if (value.length === 0) {
    throw new Error(`${label} identity is empty: ${factIdentity}`);
  }
}
