import { assertNullableString, assertObject, assertOneOf, assertKeys, requireString } from "../../decoding/index.js";
import { assertSupertagFieldMutationShape } from "./supertag-field-mutation-shape.js";

export function assertSupertagMutationShape(value: Record<string, unknown>): void {
  if (value.kind === "field-materialize") {
    requireString(value.ownerNodeId, "Field owner Node");
    requireString(value.fieldDefinitionId, "Field Definition");
    requireString(value.fieldNodeId, "Materialized Field Node");
    requireString(value.fieldOccurrenceId, "Materialized Field Occurrence");
    return;
  }
  requireString(value.supertagId, "Supertag identity");
  if (assertSupertagFieldMutationShape(value)) {
    return;
  }
  if (value.kind === "supertag-template-node-add" || value.kind === "supertag-template-node-remove") {
    requireString(value.templateNodeId, "Template Node identity");
    requireString(value.templateOccurrenceId, "Template Node Occurrence identity");
    if (value.kind === "supertag-template-node-add") {
      assertSequenceAnchor(value.anchor, "Template Node anchor");
    } else if (value.previousAnchor !== undefined) {
      assertSequenceAnchor(value.previousAnchor, "Template Node previous anchor");
    }
    return;
  }
  if (value.kind === "supertag-extension-add" || value.kind === "supertag-extension-remove") {
    requireString(value.baseSupertagId, "Base Supertag identity");
    if (value.kind === "supertag-extension-add") {
      assertSequenceAnchor(value.anchor, "Supertag Extension anchor");
    } else if (value.previousAnchor !== undefined) {
      assertSequenceAnchor(value.previousAnchor, "Supertag Extension previous anchor");
    }
    return;
  }
  if (value.kind === "supertag-apply" || value.kind === "supertag-remove") {
    requireString(value.hostNodeId, "Supertag Application host Node");
    requireString(value.applicationNodeId, "Supertag Application relation Node");
    requireString(value.applicationOccurrenceId, "Supertag Application relation Occurrence");
    requireString(value.relationDefinitionOccurrenceId, "Node supertags relation Definition endpoint Occurrence");
    requireString(value.definitionOccurrenceId, "Supertag Definition endpoint Occurrence");
    if (value.kind === "supertag-apply") {
      assertSequenceAnchor(value.anchor, "Supertag Application anchor");
    } else {
      requireString(value.detachedValueNodeId, "detached Supertag value Node");
      requireString(value.detachedValueOccurrenceId, "detached Supertag value Occurrence");
      if (value.previousAnchor !== undefined) {
        assertSequenceAnchor(value.previousAnchor, "Supertag Application previous anchor");
      }
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
