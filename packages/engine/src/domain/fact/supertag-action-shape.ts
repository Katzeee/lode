import { assertNullableString, assertObject, assertOneOf, assertKeys, requireString } from "../../decoding/index.js";
import { assertSupertagFieldActionShape } from "./supertag-field-action-shape.js";

export function assertSupertagActionShape(value: Record<string, unknown>): void {
  if (value.kind === "field-materialize") {
    requireString(value.ownerNodeId, "Field owner Node");
    requireString(value.fieldDefinitionId, "Field Definition");
    requireString(value.fieldNodeId, "Materialized Field Node");
    requireString(value.fieldOccurrenceId, "Materialized Field Occurrence");
    return;
  }
  if (assertSupertagFieldActionShape(value)) {
    return;
  }
  requireString(value.supertagId, "Supertag identity");
  if (value.kind === "template-member-add" || value.kind === "template-member-remove") {
    requireString(value.templateNodeId, "Template Node identity");
    if (value.kind === "template-member-add") {
      assertSequenceAnchor(value.anchor, "Template Node anchor");
    }
    return;
  }
  if (value.kind === "supertag-extension-add" || value.kind === "supertag-extension-remove") {
    requireString(value.baseSupertagId, "Base Supertag identity");
    if (value.kind === "supertag-extension-add") {
      assertSequenceAnchor(value.anchor, "Supertag Extension anchor");
    }
    return;
  }
  if (value.kind === "supertag-application-add" || value.kind === "supertag-membership-remove") {
    requireString(value.hostNodeId, "Supertag Application host Node");
    if (value.kind === "supertag-application-add") {
      assertSequenceAnchor(value.anchor, "Supertag Application anchor");
    }
  }
}

function assertSequenceAnchor(value: unknown, label: string): void {
  assertObject(value, label);
  assertKeys(value, ["after", "before", "affinity", "fallback"], label);
  assertNullableString(value.after, "anchor after");
  assertNullableString(value.before, "anchor before");
  assertOneOf(value.affinity, ["after", "before"], "anchor affinity");
  assertOneOf(value.fallback, ["start", "end"], "anchor fallback");
}
